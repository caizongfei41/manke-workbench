import {
  SCRIPT_TEMPLATE,
  parseScriptDocument,
  type ScriptAsset,
} from '@/core/effects/script-document';
import {
  ENHANCE_RULES,
  createEmptyEnhancement,
  type EnhanceRuleId,
  type PromptEnhancement,
} from '@/core/drama/prompt-enhance';

/**
 * AI 短剧画布的文档模型。
 *
 * 节点之间的关系就是数据流向：
 *
 *   剧本 ──▶ 分镜台 ──┬─▶ 公共资产图 ─┐
 *                      │               ├─▶ 分段工作台 ×N ──▶ 最终视频台
 *                      └─▶ 分镜资产图 ─┘
 *
 * 分镜台负责把剧本切成段落并抽出人物/场景/道具；分段工作台只负责「这一段用
 * 哪些图、什么提示词、多长」，最终台把所有分段的成片接成一条。
 */

/**
 * One rendered take of a shot.
 *
 * Generating again used to overwrite the previous result, so picking the best
 * take was impossible — and a retry that came out worse destroyed good work.
 * Every result is kept; `videoUrl` points at the adopted one.
 */
export type ShotVersion = {
  id: string;
  url: string;
  /** 生成时间，方便按新旧排。 */
  createdAt: number;
};

/** 每段保留的版本数上限，避免快照无限长。 */
export const MAX_SHOT_VERSIONS = 5;

export type DramaShot = {
  id: string;
  /** 这一段的提示词，来自分镜台，可以在分段工作台里改。 */
  prompt: string;
  seconds: number;
  /** 这一段用到的公共素材 id。 */
  publicAssetIds: string[];
  /** 这一段自己的参考图（上传或从公共资产里挑）。 */
  ownImageUrls: string[];
  /** 生成结果。 */
  videoUrl?: string | null;
  /** Every take rendered for this shot, newest first. */
  versions?: ShotVersion[];
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  error?: string | null;
};

export type NodePosition = { x: number; y: number };

export type DramaLora = { file: string; strength: number };

/**
 * Generation parameters for the whole film.
 *
 * These come straight from the AICG3D global node; the canvas used to hardcode
 * a 480P baseline, which meant quality could not be changed from the board at
 * all. Missing keys fall back to the template defaults.
 */
export type DramaParams = Record<string, string | number | boolean>;

/**
 * A wire between two nodes.
 *
 * Wires are not decoration: `assets → shot` decides whether a shot inherits the
 * shared cast, and `shot → final` decides whether the shot makes it into the
 * finished film. Cutting either one changes the render.
 */
export type DramaLink = { from: string; to: string };

export type DramaDocument = {
  version: 1;
  script: string;
  /**
   * Where each node sits on the board. Missing entries fall back to the default
   * pipeline layout, so a document saved before dragging existed still opens.
   */
  positions: Record<string, NodePosition>;
  /** Wires between nodes; see DramaLink for what each one controls. */
  links: DramaLink[];
  /** Global generation parameters shown on the 参数台 node. */
  params: DramaParams;
  /** LoRA slots applied to every shot. */
  loras: DramaLora[];
  /** Burn the dialogue into the picture when assembling. */
  subtitles: boolean;
  /** Appended constraints for every shot; see prompt-enhance. */
  enhance: PromptEnhancement;
  /** Export target; see EXPORT_PRESETS. */
  exportPreset: string;
  /** Music bed mixed under the generated audio. */
  bgmAssetId?: string | null;
  bgmName?: string | null;
  bgmVolume: number;
  /** 公共资产：整部片子共用的人物/场景/道具。 */
  publicAssets: ScriptAsset[];
  shots: DramaShot[];
  /** 最终合成结果。 */
  finalVideoUrl?: string | null;
  /** Why the last compose did not start, so the panel can say it plainly. */
  finalError?: string | null;
  finalStatus: 'idle' | 'running' | 'succeeded' | 'failed';
};

/** The pipeline as it ships: script feeds the board, the board feeds assets,
 *  every shot draws from assets and lands in the final cut. */
export const defaultLinks = (shotIds: string[]): DramaLink[] => [
  { from: 'script', to: 'board' },
  { from: 'board', to: 'assets' },
  ...shotIds.flatMap((id) => [
    { from: 'assets', to: id },
    { from: id, to: 'final' },
  ]),
];

export const createEmptyDramaDocument = (): DramaDocument => ({
  version: 1,
  script: '',
  positions: {},
  links: defaultLinks([]),
  params: {},
  loras: [],
  subtitles: true,
  enhance: createEmptyEnhancement(),
  exportPreset: 'vertical',
  bgmAssetId: null,
  bgmName: null,
  bgmVolume: 0.25,
  publicAssets: [],
  shots: [],
  finalVideoUrl: null,
  finalStatus: 'idle',
});

let seq = 0;
const nextShotId = () => {
  seq += 1;
  return `shot-${Date.now().toString(36)}-${seq}`;
};

/** 从剧本生成分镜：段落直接变成分段工作台。 */
export const buildShotsFromScript = (script: string): DramaShot[] => {
  const parsed = parseScriptDocument(script);
  return parsed.segments.map((seg) => ({
    id: nextShotId(),
    prompt: seg.prompt,
    seconds: seg.seconds,
    // A shot inherits every character/scene/prop named in its own prompt. This
    // is what feeds reference images into the render; leaving it empty meant
    // consistency rested on prompt text alone and faces drifted between shots.
    publicAssetIds: parsed.assets
      .filter((asset) => asset.name && seg.prompt.includes(asset.name))
      .map((asset) => asset.id),
    ownImageUrls: [],
    videoUrl: null,
    status: 'idle',
    error: null,
  }));
};

/**
 * Re-point shot asset ids after a merge.
 *
 * Merge keeps the id of an asset that already existed, so ids captured before the
 * merge can go stale. Map them through kind+name and drop anything that no longer
 * exists.
 */
export const linkAssetsToShots = (
  shots: DramaShot[],
  parsedAssets: ScriptAsset[],
  mergedAssets: ScriptAsset[]
): DramaShot[] => {
  const keyOfParsed = new Map(parsedAssets.map((asset) => [asset.id, `${asset.kind}:${asset.name}`]));
  const idOfMerged = new Map(mergedAssets.map((asset) => [`${asset.kind}:${asset.name}`, asset.id]));
  const alive = new Set(mergedAssets.map((asset) => asset.id));
  return shots.map((shot) => ({
    ...shot,
    publicAssetIds: shot.publicAssetIds
      .map((id) => {
        const key = keyOfParsed.get(id);
        return key ? (idOfMerged.get(key) ?? id) : id;
      })
      .filter((id) => alive.has(id)),
  }));
};

/** 分镜台的分析结果：段落 + 抽出来的人物/场景/道具。 */
export const analyzeScript = (script: string) => {
  const parsed = parseScriptDocument(script);
  return { segments: parsed.segments, assets: parsed.assets };
};

export const loadDramaDocument = (raw: string | undefined | null): DramaDocument => {
  if (!raw) return createEmptyDramaDocument();
  try {
    const parsed = JSON.parse(raw) as Partial<DramaDocument>;
    if (!parsed || typeof parsed !== 'object') return createEmptyDramaDocument();
    return {
      version: 1,
      script: typeof parsed.script === 'string' ? parsed.script : '',
      positions:
        parsed.positions && typeof parsed.positions === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.positions as Record<string, unknown>)
                .map(([key, value]) => {
                  const point = value as { x?: unknown; y?: unknown };
                  return typeof point?.x === 'number' && typeof point?.y === 'number'
                    ? [key, { x: point.x, y: point.y }]
                    : null;
                })
                .filter((entry): entry is [string, NodePosition] => entry !== null)
            )
          : {},
      publicAssets: Array.isArray(parsed.publicAssets) ? parsed.publicAssets : [],
      shots: Array.isArray(parsed.shots)
        ? parsed.shots.map((shot) => ({
            id: typeof shot.id === 'string' ? shot.id : nextShotId(),
            prompt: typeof shot.prompt === 'string' ? shot.prompt : '',
            seconds: typeof shot.seconds === 'number' ? shot.seconds : 3,
            publicAssetIds: Array.isArray(shot.publicAssetIds) ? shot.publicAssetIds : [],
            ownImageUrls: Array.isArray(shot.ownImageUrls) ? shot.ownImageUrls : [],
            videoUrl: typeof shot.videoUrl === 'string' ? shot.videoUrl : null,
            status: (shot.status ?? 'idle') as DramaShot['status'],
            error: typeof shot.error === 'string' ? shot.error : null,
            versions: Array.isArray((shot as { versions?: unknown }).versions)
              ? ((shot as { versions: unknown[] }).versions
                  .map((entry) => {
                    const item = entry as { id?: unknown; url?: unknown; createdAt?: unknown };
                    if (typeof item?.url !== 'string' || !item.url) return null;
                    return {
                      id: typeof item.id === 'string' ? item.id : item.url,
                      url: item.url,
                      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
                    };
                  })
                  .filter((entry): entry is ShotVersion => entry !== null)
                  .slice(0, MAX_SHOT_VERSIONS) as ShotVersion[])
              : [],
          }))
        : [],
      links: (() => {
        const shots = Array.isArray(parsed.shots) ? parsed.shots : [];
        const shotIds = shots
          .map((shot) => (typeof shot.id === 'string' ? shot.id : ''))
          .filter(Boolean);
        const raw = (parsed as { links?: unknown }).links;
        if (!Array.isArray(raw)) return defaultLinks(shotIds);
        const links = raw
          .map((link) => {
            const value = link as { from?: unknown; to?: unknown };
            return typeof value?.from === 'string' && typeof value?.to === 'string'
              ? { from: value.from, to: value.to }
              : null;
          })
          .filter((link): link is DramaLink => link !== null);
        return links.length > 0 ? links : defaultLinks(shotIds);
      })(),
      params:
        parsed.params && typeof parsed.params === 'object'
          ? (parsed.params as DramaParams)
          : {},
      subtitles: parsed.subtitles === true,
      enhance: (() => {
        const raw = (parsed as { enhance?: unknown }).enhance as
          | { enabled?: unknown; rules?: unknown; extra?: unknown }
          | undefined;
        if (!raw) return createEmptyEnhancement();
        const valid = ENHANCE_RULES.map((rule) => rule.id);
        return {
          enabled: raw.enabled === true,
          rules: Array.isArray(raw.rules)
            ? (raw.rules.filter(
                (id): id is EnhanceRuleId => typeof id === 'string' && valid.includes(id as EnhanceRuleId)
              ) as EnhanceRuleId[])
            : [],
          extra: typeof raw.extra === 'string' ? raw.extra : '',
        };
      })(),
      exportPreset: typeof parsed.exportPreset === 'string' ? parsed.exportPreset : 'vertical',
      bgmAssetId: typeof parsed.bgmAssetId === 'string' ? parsed.bgmAssetId : null,
      bgmName: typeof parsed.bgmName === 'string' ? parsed.bgmName : null,
      bgmVolume: typeof parsed.bgmVolume === 'number' ? parsed.bgmVolume : 0.25,
      loras: Array.isArray(parsed.loras)
        ? parsed.loras
            .map((entry) => {
              const value = entry as { file?: unknown; strength?: unknown };
              return typeof value?.file === 'string'
                ? {
                    file: value.file,
                    strength:
                      typeof value.strength === 'number' ? value.strength : 1,
                  }
                : null;
            })
            .filter((entry): entry is DramaLora => entry !== null)
        : [],
      finalVideoUrl:
        typeof parsed.finalVideoUrl === 'string' ? parsed.finalVideoUrl : null,
      finalError: typeof parsed.finalError === 'string' ? parsed.finalError : null,
      finalStatus: (parsed.finalStatus ?? 'idle') as DramaDocument['finalStatus'],
    };
  } catch {
    return createEmptyDramaDocument();
  }
};

export const serializeDramaDocument = (doc: DramaDocument): string =>
  JSON.stringify(doc);

export const dramaTemplate = () => SCRIPT_TEMPLATE;

/** 总时长，用于最终台显示。 */
export const totalSeconds = (shots: DramaShot[]): number =>
  shots.reduce((sum, shot) => sum + (Number(shot.seconds) || 0), 0);

/**
 * Fixed generation settings for the drama pipeline.
 *
 * These are literal identifiers the ComfyUI graph matches by string, so they must
 * not be translated — which is also why they live here and not in the component.
 */
export const DRAMA_MODEL_ID = '小枫-aicg3d-h3-长视频';
export const DRAMA_GLOBAL = {
  resolution: '480P',
  vram_policy: '卸载模型',
} as const;
export const DRAMA_ASPECT_RATIO = '9:16';

/**
 * Merge a freshly parsed cast into the existing one.
 *
 * Re-splitting used to keep whatever assets already existed, so editing the
 * script never produced new characters or scenes. Matching by kind and name
 * keeps an asset's uploaded image while letting the list follow the script.
 */
export const mergeAssets = (
  existing: ScriptAsset[],
  incoming: ScriptAsset[]
): ScriptAsset[] => {
  const byKey = new Map(existing.map((asset) => [`${asset.kind}:${asset.name}`, asset]));
  return incoming.map((asset) => {
    const match = byKey.get(`${asset.kind}:${asset.name}`);
    if (!match) return asset;
    return {
      ...match,
      description: asset.description || match.description,
    };
  });
};

import {
  SCRIPT_TEMPLATE,
  parseScriptDocument,
  type ScriptAsset,
} from '@/core/effects/script-document';

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
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  error?: string | null;
};

export type DramaDocument = {
  version: 1;
  script: string;
  /** 公共资产：整部片子共用的人物/场景/道具。 */
  publicAssets: ScriptAsset[];
  shots: DramaShot[];
  /** 最终合成结果。 */
  finalVideoUrl?: string | null;
  finalStatus: 'idle' | 'running' | 'succeeded' | 'failed';
};

export const createEmptyDramaDocument = (): DramaDocument => ({
  version: 1,
  script: '',
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
    publicAssetIds: [],
    ownImageUrls: [],
    videoUrl: null,
    status: 'idle',
    error: null,
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
          }))
        : [],
      finalVideoUrl:
        typeof parsed.finalVideoUrl === 'string' ? parsed.finalVideoUrl : null,
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

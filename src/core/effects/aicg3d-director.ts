import type { AssetKind, ScriptAsset } from './script-document';

/**
 * AICG3D 分段长视频的导演台数据层。
 *
 * 三个「H3 长视频」模板共用同一套结构：一个 SequenceGlobal 放全局参数、若干
 * SequenceSegment 串联出片、一个 H3Loader 挂 9 个 LoRA 槽。工作台此前只把同一个
 * 提示词写进每一段，等于把分段白白浪费掉，这里把每个可调项都接出来。
 *
 * 取值全部照抄 ComfyUI 的 /object_info，因为节点是拿字符串直接比对的 —— 传一个
 * 不在枚举里的值不会报错，只会让那一项悄悄失效。
 */

export type DirectorFieldType = 'select' | 'number' | 'boolean';

export type DirectorField = {
  /** SequenceGlobal 上的输入名。 */
  key: string;
  label: string;
  type: DirectorFieldType;
  group: 'output' | 'motion' | 'sampling' | 'memory' | 'audio';
  options?: readonly string[];
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
};

const RESOLUTIONS = [
  '360P', '416P', '480P', '540P', '640P', '720P',
  '768P', '832P', '960P', '1024P', '1080P',
] as const;

const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'] as const;

export const DIRECTOR_FIELDS: readonly DirectorField[] = [
  {
    key: 'resolution',
    label: '分辨率',
    type: 'select',
    group: 'output',
    default: '1080P',
    options: RESOLUTIONS,
    hint: '1080P 是 1920×1088；越高越慢，显存占用也越高。',
  },
  {
    key: 'aspect_ratio',
    label: '画面比例',
    type: 'select',
    group: 'output',
    default: '16:9',
    options: ASPECTS,
    hint: '竖屏选 9:16，宽银幕选 21:9。',
  },
  {
    key: 'ref_image_size',
    label: '参考图尺寸',
    type: 'select',
    group: 'output',
    default: 'match',
    options: ['match', '1k', '1.5k', '2k', 'original'],
    hint: 'match 跟随输出分辨率。参考图很大时调小可以省显存。',
  },
  {
    key: 'handoff_frames',
    label: '交接帧数',
    type: 'number',
    group: 'motion',
    default: 5,
    min: 1,
    max: 22,
    step: 1,
    hint: '段与段之间重叠多少帧。越大衔接越顺，也越慢。',
  },
  {
    key: 'handoff_mode',
    label: '衔接方式',
    type: 'select',
    group: 'motion',
    default: '尾帧续写（latent）',
    options: ['尾帧续写（latent）', '尾帧画面（RGB）'],
    hint: 'latent 接得更自然；RGB 更贴近上一段的实际画面。',
  },
  {
    key: 'exposure_lock',
    label: '曝光锁定',
    type: 'select',
    group: 'motion',
    default: '跨段曝光锁定',
    options: ['关闭', '跨段曝光锁定'],
    hint: '开着可以避免段与段之间亮度跳变。',
  },
  {
    key: 'steps',
    label: '采样步数',
    type: 'number',
    group: 'sampling',
    default: 4,
    min: 1,
    max: 60,
    step: 1,
    hint: '模板默认 4（配了 4 步加速 LoRA）。换普通 LoRA 时要提高到 20 以上。',
  },
  {
    key: 'denoise',
    label: '去噪强度',
    type: 'number',
    group: 'sampling',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'sampler_name',
    label: '采样器',
    type: 'select',
    group: 'sampling',
    default: 'res_multistep',
    options: [
      'res_multistep', 'euler', 'euler_cfg_pp', 'euler_ancestral',
      'euler_ancestral_cfg_pp', 'heun', 'heunpp2', 'dpm_2',
      'dpm_2_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde',
      'dpmpp_sde', 'lms', 'ddim', 'uni_pc',
    ],
    hint: '模板默认 res_multistep，和 4 步加速 LoRA 配套，不建议乱换。',
  },
  {
    key: 'scheduler',
    label: '调度器',
    type: 'select',
    group: 'sampling',
    default: 'simple',
    options: [
      'simple', 'sgm_uniform', 'karras', 'exponential',
      'ddim_uniform', 'beta', 'normal', 'linear_quadratic',
    ],
  },
  {
    key: 'vram_tier',
    label: '显存档位',
    type: 'select',
    group: 'memory',
    default: '自动（按显卡）',
    options: ['自动（按显卡）', '16G', '12G', '8G'],
    hint: '自动会读显卡显存自己挑档位，换机器不用改。',
  },
  {
    key: 'vram_policy',
    label: '显存策略',
    type: 'select',
    group: 'memory',
    default: '释放缓存',
    options: ['卸载模型', '释放缓存', '不处理'],
    hint: '显存吃紧选「卸载模型」，最快但段间会重新加载。',
  },
  {
    key: 'keep_full',
    label: '保留完整精度',
    type: 'boolean',
    group: 'memory',
    default: true,
    hint: '关掉可以省一点显存，画质会略降。',
  },
  {
    key: 'audio_mode',
    label: '音频模式',
    type: 'select',
    group: 'audio',
    default: '生成音频',
    options: ['生成音频', '数字人（锁定音频）'],
    hint: '数字人模式会把素材库里的音频当驱动音轨，锁定口型。',
  },
  {
    key: 'sample_preview',
    label: '采样预览',
    type: 'select',
    group: 'sampling',
    default: '关',
    options: ['关', '开'],
    hint: '开着能看到逐步预览，但会拖慢速度。',
  },
];

export const DIRECTOR_GROUP_LABELS: Record<DirectorField['group'], string> = {
  output: '输出',
  motion: '运镜与衔接',
  sampling: '采样',
  memory: '显存',
  audio: '音频',
};

/** H3Loader 上有 9 个 LoRA 槽，每个带独立强度。 */
export const LORA_SLOT_COUNT = 9;

/**
 * LoRA 下拉里的常见项。完整列表由 ComfyUI 提供，这里只是把常用的排前面，
 * 界面仍然允许填任意文件名（自定义 LoRA 不会被这个列表限制）。
 */
export const COMMON_LORAS: readonly string[] = [
  'none',
  'minimax\\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors',
  'minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors',
  'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
  '电影感loraV1.0正式版.safetensors',
  'h3_char_lora_v1_s200.safetensors',
  'H3_Combat_V2.safetensors',
  'minimax\\GunFu.safetensors',
];

export type DirectorLora = { file: string; strength: number };

export type DirectorSegment = {
  prompt: string;
  /** 段落时长（秒），节点范围 0.2~30。 */
  seconds: number;
  /** 每段独立的参考图 URL（手动加的）。 */
  imageUrls?: string[];
  /**
   * 这一段用到的素材 id（人物/场景/道具）。
   *
   * 保持一致性靠的就是这个：同一个角色在每一段都挂同一张定妆图，
   * 模型才有稳定的参考。提交时按「人物 → 场景 → 道具」的顺序展开成图片，
   * 这个顺序也就是提示词里 <Picture N> 的编号。
   */
  assetIds?: string[];
};

export type DirectorSettings = {
  global: Record<string, string | number | boolean>;
  loras: DirectorLora[];
  segments: DirectorSegment[];
  /** 从剧本里分析出的人物/场景/道具，每项可以生成或上传参考图。 */
  assets: ScriptAsset[];
};

export const getDefaultDirectorGlobal = (): Record<string, string | number | boolean> =>
  Object.fromEntries(DIRECTOR_FIELDS.map((f) => [f.key, f.default]));

export const getDefaultDirectorSettings = (): DirectorSettings => ({
  global: getDefaultDirectorGlobal(),
  loras: [{ file: 'none', strength: 1 }],
  segments: [],
  assets: [],
});

/**
 * 剧本 → 分镜。
 *
 * 按空行切段，同时把这些常见的分镜标记当分隔符：`镜头 1`、`Shot 1`、`[Shot 1]`、
 * `1.`、`（一）`。切完把纯标记行丢掉，只留实际描述；再按字数估一个大致时长
 * （中文口播约每秒 4 字，最低 2 秒、最高 10 秒，落在节点的 0.2~30 范围内）。
 */
export const splitScriptIntoShots = (script: string): DirectorSegment[] => {
  const text = script.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const MARKER =
    /^(?:[\[【(（]?\s*(?:镜头|分镜|场次|shot|scene)\s*[0-9一二三四五六七八九十]+\s*[\]】)）]?\s*[:：.、]?|[0-9]{1,2}[.、)]|[（(][一二三四五六七八九十]+[)）])\s*/i;

  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const body = current.join('\n').trim();
    if (body) blocks.push(body);
    current = [];
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    if (MARKER.test(line)) {
      flush();
      const rest = line.replace(MARKER, '').trim();
      if (rest) current.push(rest);
      continue;
    }
    current.push(line);
  }
  flush();

  if (blocks.length === 0) return [];

  return blocks.map((block) => {
    const chars = block.replace(/\s/g, '').length;
    const seconds = Math.min(10, Math.max(2, Math.round(chars / 4)));
    return { prompt: block, seconds };
  });
};

/** 只把用户改过的全局参数发出去，其余交给模板默认值。 */
export const pickChangedDirectorGlobal = (
  value: Record<string, string | number | boolean> | undefined
): Record<string, string | number | boolean> => {
  if (!value) return {};
  const defaults = getDefaultDirectorGlobal();
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (defaults[k] !== v && v !== undefined && v !== '') out[k] = v;
  }
  return out;
};

/**
 * 把分段挂的素材展开成参考图 URL。
 *
 * 顺序固定为 人物 → 场景 → 道具，再接手动图：H3 按顺序把素材编号成
 * <Picture 1>、<Picture 2>…，顺序一变，同一个角色就会指到别的图上，
 * 一致性立刻崩掉。所以这里不允许调用方随便排序。
 */
export type SegmentRef = {
  kind: AssetKind;
  name: string;
  description?: string;
};

const REF_ORDER: Record<string, number> = { character: 0, scene: 1, prop: 2 };

/**
 * 把分段挂的素材展开成「参考图 URL + 对应身份」。
 *
 * 顺序固定为 人物 → 场景 → 道具，再接手动图。顺序不能变：H3 按顺序把素材
 * 编号成 <Picture 1>、<Picture 2>…，顺序一动，同一个角色就指到别的图上。
 */
export const resolveSegmentReferences = (
  segment: Pick<DirectorSegment, 'assetIds' | 'imageUrls'>,
  assets: ScriptAsset[]
): { urls: string[]; refs: SegmentRef[] } => {
  const picked = (segment.assetIds ?? [])
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is ScriptAsset => !!a && !!a.imageUrl)
    .sort((a, b) => (REF_ORDER[a.kind] ?? 9) - (REF_ORDER[b.kind] ?? 9));

  const urls: string[] = [];
  const refs: SegmentRef[] = [];
  const seen = new Set<string>();
  for (const asset of picked) {
    const url = asset.imageUrl as string;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    refs.push({ kind: asset.kind, name: asset.name, description: asset.description });
  }
  for (const url of segment.imageUrls ?? []) {
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    refs.push({ kind: 'prop', name: '' });
  }
  return { urls: urls.slice(0, 9), refs: refs.slice(0, 9) };
};

/**
 * 生成把 <Subject N> 绑到 <Picture N> 的那段话。
 *
 * 只把图塞进资源库是不够的：提示词里不提「这是谁」，模型就不会保留身份，
 * 于是同一个角色在每一段长成不同的脸 —— 这正是前后不一致的原因。
 * 官方规范要求写死「<Subject 1> 是 <Picture 1> 中的人物，保留面部、发型、服装」。
 */
export const buildReferenceBinding = (refs: SegmentRef[]): string => {
  if (refs.length === 0) return '';
  const parts: string[] = [];
  let subject = 0;

  refs.forEach((ref, index) => {
    const picture = index + 1;
    if (ref.kind === 'character') {
      subject += 1;
      const who = ref.name ? `${ref.name}` : '人物';
      const look = ref.description?.trim() ? `（${ref.description.trim()}）` : '';
      parts.push(
        `<Subject ${subject}> 是 <Picture ${picture}> 中的 ${who}${look}，` +
          '保留其面部、发型、服装与体型，不要改变身份或换脸。'
      );
    } else if (ref.kind === 'scene') {
      const where = ref.name ? `${ref.name}` : '场景';
      const look = ref.description?.trim() ? `（${ref.description.trim()}）` : '';
      parts.push(
        `<Picture ${picture}> 是场景 ${where}${look}，保持其空间结构、色调与光线。`
      );
    } else {
      const what = ref.name ? `${ref.name}` : '道具';
      parts.push(`<Picture ${picture}> 是道具 ${what}，保持其外观与材质。`);
    }
  });

  return parts.join(' ');
};

/** 兼容旧调用：只要 URL。 */
export const resolveSegmentImages = (
  segment: Pick<DirectorSegment, 'assetIds' | 'imageUrls'>,
  assets: ScriptAsset[]
): string[] => resolveSegmentReferences(segment, assets).urls;

/** 只在真的选了 LoRA 时才下发，避免把 9 个 none 全写一遍。 */
export const pickActiveLoras = (loras: DirectorLora[] | undefined): DirectorLora[] =>
  (loras ?? []).filter((l) => l && l.file && l.file !== 'none').slice(0, LORA_SLOT_COUNT);

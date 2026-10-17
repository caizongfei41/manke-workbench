import { BaseAdapter, type EffectRecord, type GenerationResult } from './base-adapter';
import { COMFYUI_CLIENT_ID } from '@/core/effects/comfyui-progress';

const DEFAULT_COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
const DEFAULT_CONFIG_FILENAME = 'comfyui.config.json';
const DEFAULT_WORKFLOW_RELATIVE_DIR = 'comfyui/workflows';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_LOCAL_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_LOCAL_VIDEO_ASSET_BYTES = 1024 * 1024 * 1024;
/** 视频生成使用的帧率（Minimax H3 官方 24fps）。 */
const VIDEO_FPS = 24;

/** 从 BeatDesign 的 duration（如 "5s"）换算 H3 采样帧数（4k+1 形式，限制在 9..721；721≈30s@24fps）。 */
function framesFromDuration(duration: unknown): number {
  let seconds = 5;
  if (typeof duration === 'string' && /^\d+(\.\d+)?\s*s?$/i.test(duration.trim())) {
    seconds = Number.parseFloat(duration);
  } else if (typeof duration === 'number' && Number.isFinite(duration)) {
    seconds = duration;
  }
  const raw = Math.max(1, Math.round(seconds * VIDEO_FPS) + 1);
  const clamped = Math.min(721, Math.max(9, raw));
  return 4 * Math.round((clamped - 1) / 4) + 1;
}

/** 与 BeatDesign 界面宽高比约定对应的像素尺寸（SDXL 常用分辨率）。 */
const ASPECT_RATIO_SIZES: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '2:3': { width: 832, height: 1216 },
  '3:2': { width: 1216, height: 832 },
  '3:4': { width: 896, height: 1152 },
  '4:3': { width: 1152, height: 896 },
  '4:5': { width: 896, height: 1120 },
  '5:4': { width: 1120, height: 896 },
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1344, height: 768 },
  '21:9': { width: 1536, height: 640 },
  '9:21': { width: 640, height: 1536 },
  '2:1': { width: 1408, height: 704 },
  '1:2': { width: 704, height: 1408 },
  '3:1': { width: 1536, height: 512 },
  '1:3': { width: 512, height: 1536 },
};

/** 图片输出分辨率档位 → 长边像素（1k/2k/4k）。 */
const IMAGE_QUALITY_LONG_EDGES: Record<string, number> = {
  '1k': 1024,
  '2k': 2048,
  '4k': 4096,
};

/** 视频生成使用的像素尺寸（Minimax H3 768p 系列，8 对齐）。 */
const VIDEO_ASPECT_RATIO_SIZES: Record<string, { width: number; height: number }> = {
  '16:9': { width: 864, height: 480 },
  '9:16': { width: 480, height: 864 },
  '1:1': { width: 640, height: 640 },
  '4:3': { width: 640, height: 480 },
  '3:4': { width: 480, height: 640 },
  '21:9': { width: 864, height: 384 },
  '9:21': { width: 384, height: 864 },
  '2:1': { width: 864, height: 416 },
  '1:2': { width: 416, height: 864 },
  '3:1': { width: 864, height: 256 },
  '1:3': { width: 256, height: 864 },
  '2:3': { width: 480, height: 720 },
  '3:2': { width: 720, height: 480 },
  '4:5': { width: 448, height: 560 },
  '5:4': { width: 560, height: 448 },
};

type ComfyUiWorkflowConfig = {
  /** 正向提示词文本编码节点 id。 */
  positive?: string;
  /** 负向文本编码节点/字段 id（模板内自带文本则保留模板文本）。 */
  negative?: string;
  /** KSampler / WanVideoSamplerSettings / MiniMaxH3Director 节点 id（注入 seed）。 */
  seed?: string;
  /** EmptyLatentImage / WanVideoEmptyEmbeds / WanVideoImageToVideoEncode / Director 节点 id（注入宽高）。 */
  size?: string;
  /** 视频帧数字段所在节点 id（注入 num_frames / total_frames，由 duration 换算）。 */
  video_frames?: string;
  /** LoadImage 节点 id（图生图时上传首张参考图并注入），或 Director 节点 id（i2v 首帧写入 timeline_data）。 */
  image?: string;
  /** Qwen21MultiImageLoader 节点 id：全部参考图上传并写入 image_files（多图编辑）。 */
  multi_image?: string;
  /** LoraLoader 节点注入：node 为节点 id；可选 name 覆盖 lora 文件名、strength 覆盖强度。 */
  lora?: {
    node?: string;
    name?: string;
    strength?: number;
  };
  /**
   * 分辨率档位节点 id：该节点有一个字符串枚举的 `resolution` 输入
   * （AICG3D 全局设置节点，取值 360P…1080P）。界面质量选项会映射过去；
   * 质量不在映射表里就保留模板值。
   */
  resolution?: string;
  /** 音乐模板的源音频节点 id（翻唱）：上传的音频写进该节点的 audio 字段。 */
  audio?: string;
  /** 音乐模板的风格节点 id：input.style 里的键按同名写进该节点。 */
  style?: string;
};

type ComfyUiWorkflow = Record<string, unknown> & {
  _beatdesign?: ComfyUiWorkflowConfig;
};

type ComfyUiConfig = {
  baseUrl?: string;
  workflowDir?: string;
  /** 本地 python 解释器（含 PIL）路径，用于图像编辑参考图按目标比例补边。 */
  pythonPath?: string;
  workflows?: Record<string, string>;
};

type ComfyUiImageRef = {
  filename: string;
  subfolder?: string;
  type?: string;
};

type ComfyUiHistoryEntry = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<{ message?: unknown }>;
  } | null;
  outputs?: Record<
    string,
    {
      images?: ComfyUiImageRef[];
      gifs?: ComfyUiImageRef[];
      videos?: ComfyUiImageRef[];
      audio?: ComfyUiImageRef[];
    }
  >;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

async function resolveDataRoot(): Promise<string> {
  const { getBeatDesignDataRoot } = await import('@/config/data-root');
  return getBeatDesignDataRoot(process.cwd());
}

async function loadConfig(): Promise<ComfyUiConfig & {
  baseUrl: string;
  workflowDir: string;
}> {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const configuredPath =
    process.env.BEATDESIGN_COMFYUI_CONFIG?.trim() ||
    resolve(await resolveDataRoot(), DEFAULT_CONFIG_FILENAME);
  let fileConfig: ComfyUiConfig = {};
  try {
    const raw = await readFile(configuredPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (record) fileConfig = record as ComfyUiConfig;
  } catch {
    // 配置文件缺失或非法时全部回退到默认值。
    fileConfig = {};
  }

  const baseUrl =
    process.env.BEATDESIGN_COMFYUI_URL?.trim() ||
    fileConfig.baseUrl?.trim() ||
    DEFAULT_COMFYUI_BASE_URL;
  // workflowDir 的三种来源必须解析到同一个基准。
  //
  // 配置文件（data/comfyui.config.json）里的 workflowDir 是相对路径
  // "comfyui/workflows"，它和下面的兜底值含义相同——都相对于 data 目录。
  // 早先直接把配置里的字符串交给 path.resolve 使用，等于按 process.cwd()
  // （项目根）解析，于是少了一层 data\，界面里选任何模型都会报
  // "workflow template not found"。这里显式按 dataRoot 解析；
  // path.resolve 遇到绝对路径会直接返回它，所以配置里写绝对路径依然有效。
  const dataRoot = await resolveDataRoot();
  const configuredWorkflowDir = fileConfig.workflowDir?.trim();
  const workflowDir =
    process.env.BEATDESIGN_COMFYUI_WORKFLOW_DIR?.trim() ||
    (configuredWorkflowDir
      ? resolve(dataRoot, configuredWorkflowDir)
      : resolve(dataRoot, DEFAULT_WORKFLOW_RELATIVE_DIR));
  return { ...fileConfig, baseUrl, workflowDir };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('ComfyUI response exceeded the 2 MB limit');
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('ComfyUI response exceeded the 2 MB limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const asRecordArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value
        .map((item) => asRecord(item))
        .filter((record): record is Record<string, unknown> => record !== null)
    : [];

/**
 * MiniMaxH3Director / ComfyMiniMaxH3Director 模式：除各字段外，还需把
 * duration/尺寸/提示词同步进 timeline_data 内嵌 JSON（节点的执行以此为准）。
 */
type DirectorSegmentControl = {
  prompt?: string;
  duration?: number;
};

function injectDirectorInputs(
  nodeInputs: Record<string, unknown>,
  prompt: string,
  frames: number,
  size: { width: number; height: number },
  seed?: number | string,
  controlSegments?: DirectorSegmentControl[],
  referenceCount?: number
): void {
  const taskType = readString(nodeInputs.task_type) ?? '';
  // 模式默认由模型模板决定；但 t2v（文生）模板在界面提供参考图时
  // 自动切换为 r2v（参考主体生视频）——用户拖入参考图即表示按参考主体生成，
  // 否则参考图会被文生路径当作无用输入丢弃。
  let resolvedTaskType = taskType;
  const hasReference = (referenceCount ?? 0) > 0;
  if (taskType.includes('t2v') && hasReference) {
    resolvedTaskType = 'r2v — 参考主体生视频(Reference to Video)';
    nodeInputs.task_type = resolvedTaskType;
  }
  // 界面逐段控制提供各段时长时：总帧数以各段时长之和为准
  // （每段写 1s/2s/3s → 总 6s），而非界面总时长默认值（5s）——
  // 否则用户写的每段秒数只按比例分配，写 1s/2s/3s 不生效。
  const segmentDurations = Array.isArray(controlSegments)
    ? controlSegments.filter(
        (c): c is DirectorSegmentControl =>
          !!c && typeof c === 'object' && !Array.isArray(c)
      )
    : [];
  const hasSegDuration = segmentDurations.some(
    (c) => typeof c.duration === 'number' && c.duration > 0
  );
  if (hasSegDuration) {
    const totalSec = segmentDurations.reduce(
      (sum, c) => sum + (typeof c.duration === 'number' ? c.duration : 0),
      0
    );
    if (totalSec > 0) {
      frames = framesFromDuration(`${totalSec}s`);
    }
  }
  // 用户原始提示词（非空才算"界面提供了提示词"，多段模板据此覆盖段 prompt）。
  const userPrompt = readString(prompt) ?? '';
  // r2v（参考主体）：用户提示词未显式写 <Picture N> 时自动注入参考主体指令。
  // 多张参考图时列出全部 <Picture N> 标签（模板 refs 已按图序写入 timeline）。
  const refCount = Math.max(0, referenceCount ?? 0);
  const pictureTags =
    refCount > 0
      ? Array.from({ length: refCount }, (_, i) => `<Picture ${i + 1}>`).join(' ')
      : '';
  const effectivePrompt =
    resolvedTaskType.includes('r2v') && !/<Picture\s*\d/i.test(prompt)
      ? `${pictureTags} 参考主体（保持各人物/主体外观一致）。${prompt}`
      : prompt;
  const timelineRaw = nodeInputs.timeline_data;
  let isMultiSegment = false;
  if (typeof timelineRaw === 'string' && timelineRaw.trim()) {
    try {
      const timeline = JSON.parse(timelineRaw) as Record<string, unknown>;
      isMultiSegment =
        (Array.isArray(timeline.segments) ? timeline.segments : []).length > 1;
    } catch {
      // timeline_data 解析失败时按单段处理。
    }
  }
  if ('global_prompt' in nodeInputs) {
    nodeInputs.global_prompt = effectivePrompt;
  }
  // 界面 seed 覆盖 Director 节点级 seed（导演台模板此前固定用模板内 seed）。
  if (seed !== undefined && 'seed' in nodeInputs) {
    nodeInputs.seed = Number(seed);
  }
  if (!isMultiSegment) {
    // 单段模板：按界面 duration/宽高比覆盖帧数与尺寸。
    if ('total_frames' in nodeInputs) {
      nodeInputs.total_frames = frames;
    }
    if ('width' in nodeInputs) {
      nodeInputs.width = size.width;
    }
    if ('height' in nodeInputs) {
      nodeInputs.height = size.height;
    }
    if ('frame_rate' in nodeInputs) {
      nodeInputs.frame_rate = VIDEO_FPS;
    }
  }
  if (typeof timelineRaw !== 'string' || !timelineRaw.trim()) return;
  try {
    const timeline = JSON.parse(timelineRaw) as Record<string, unknown>;
    let segments = Array.isArray(timeline.segments)
      ? timeline.segments
      : [];
    // t2v 模板 或 界面未传参考图：清空所有模式段的模板残留参考图，
    // 避免文生视频/无参考场景仍引用模板默认图。
    if (resolvedTaskType.includes('t2v') || referenceCount === 0) {
      const clearAllRefs = (seg: unknown) => {
        const segment = asRecord(seg);
        if (segment) segment.refs = [];
      };
      for (const seg of segments) clearAllRefs(seg);
      const batch = asRecord(timeline.batchWorkspaces);
      if (batch) {
        for (const [, ws] of Object.entries(batch)) {
          const wsRec = asRecord(ws);
          if (wsRec && Array.isArray(wsRec.segments)) {
            for (const seg of wsRec.segments) clearAllRefs(seg);
          }
        }
      }
      const global = asRecord(timeline.global);
      if (global) global.refs = [];
    }
    // ---- 界面逐段控制（controlSegments）：模板段数与界面段数不同时，以界面段数为准重建 timeline.segments ----
    const segControl = Array.isArray(controlSegments)
      ? controlSegments.filter(
          (c): c is DirectorSegmentControl =>
            !!c && typeof c === 'object' && !Array.isArray(c)
        )
      : [];
    if (segControl.length > 0 && segControl.length !== segments.length) {
      const templateSegs = segments
        .map((s) => asRecord(s))
        .filter((s): s is Record<string, unknown> => s !== null);
      const hasSegDur = segControl.some(
        (c) => typeof c.duration === 'number' && c.duration > 0
      );
      const segDurTotal = hasSegDur
        ? segControl.reduce(
            (sum, c) => sum + (typeof c.duration === 'number' ? c.duration : 0),
            0
          )
        : 0;
      const firstRefs =
        templateSegs.length > 0 && Array.isArray(templateSegs[0].refs)
          ? templateSegs[0].refs
          : [];
      const firstPrompt =
        templateSegs.length > 0 &&
        typeof templateSegs[0].prompt === 'string'
          ? templateSegs[0].prompt
          : '';
      let segAcc = 0;
      const rebuilt = segControl.map((c, i) => {
        const isLast = i === segControl.length - 1;
        let len: number;
        if (hasSegDur && typeof c.duration === 'number' && c.duration > 0) {
          len = Math.max(4, Math.round((c.duration * frames) / segDurTotal));
        } else {
          len = Math.max(4, Math.round(frames / segControl.length));
        }
        if (isLast) {
          const remain = frames - segAcc;
          len = remain > 0 ? remain : len;
        }
        segAcc += len;
        const segPrompt =
          typeof c.prompt === 'string' && c.prompt.trim()
            ? c.prompt.trim()
            : userPrompt || firstPrompt;
        return {
          prompt: segPrompt,
          length: len,
          frameCount: len,
          start: segAcc - len,
          durationSec: Math.max(1, Math.round(len / VIDEO_FPS)),
          refs: firstRefs,
          continuityFromPrev: true,
        };
      });
      timeline.segments = rebuilt;
      segments = rebuilt;
      isMultiSegment = true;
      // batchWorkspaces 各模式段（t2v/r2v/mixed）同步重建为界面段数，
      // 避免 Director 按模式路由时沿用模板残留段数导致时长/段数错乱。
      const batchWs = asRecord(timeline.batchWorkspaces);
      if (batchWs) {
        for (const [, ws] of Object.entries(batchWs)) {
          const wsRec = asRecord(ws);
          if (!wsRec || !Array.isArray(wsRec.segments)) continue;
          const wsSegsArr = wsRec.segments as Array<Record<string, unknown>>;
          let bAcc = 0;
          wsRec.segments = rebuilt.map((s, i) => {
            const base =
              asRecord(wsSegsArr[Math.min(i, wsSegsArr.length - 1)]) ?? {};
            const len = s.length;
            const r: Record<string, unknown> = {
              ...base,
              prompt: s.prompt,
              length: len,
              frameCount: len,
              start: bAcc,
              durationSec: s.durationSec,
              refs: s.refs,
              continuityFromPrev: true,
            };
            if (typeof r._videoFrameCount === 'number') {
              r._videoFrameCount = len;
            }
            bAcc += len;
            return r;
          });
        }
      }
      timeline.totalFrames = frames;
      timeline.frameRate = VIDEO_FPS;
      timeline.width = size.width;
      timeline.height = size.height;
      const tlOutput = asRecord(timeline.output);
      if (tlOutput) {
        tlOutput.width = size.width;
        tlOutput.height = size.height;
      }
      nodeInputs.total_frames = frames;
    }
    if (!isMultiSegment) {
      timeline.totalFrames = frames;
      timeline.frameRate = VIDEO_FPS;
      timeline.width = size.width;
      timeline.height = size.height;
      const output = asRecord(timeline.output);
      if (output) {
        output.width = size.width;
        output.height = size.height;
      }
    } else {
      // 多段导演台模板（segments>1）：把界面 duration 换算出的总帧数
      // 按各段原长度比例摊回每一段（尾段吸收取整误差），并同步
      // totalFrames / 分辨率 / Director 独立 total_frames 字段，
      // 保证实际生成时长与界面选择一致（Director 以每段帧数为准执行）。
      const segs = segments
        .map((s) => asRecord(s))
        .filter((s): s is Record<string, unknown> => s !== null);
      const origTotal =
        segs.reduce(
          (sum, s) =>
            sum +
            (typeof s.length === 'number'
              ? s.length
              : typeof s.frameCount === 'number'
                ? s.frameCount
                : 0),
          0
        ) || frames;
      // 界面逐段控制（segments 参数）存在且有时长值时：按各段 duration 比例分配帧数；
      // 段时长缺失回退等比分摊；无界面控制时按模板原长度比例。
      const segControl = Array.isArray(controlSegments)
        ? controlSegments.filter(
            (c): c is DirectorSegmentControl =>
              !!c && typeof c === 'object' && !Array.isArray(c)
          )
        : [];
      const hasSegDuration = segControl.some(
        (c) => typeof c.duration === 'number' && c.duration > 0
      );
      const durTotal = hasSegDuration
        ? segControl.reduce(
            (sum, c) => sum + (typeof c.duration === 'number' ? c.duration : 0),
            0
          )
        : 0;
      let acc = 0;
      const newLengths = segs.map((s, i) => {
        if (i === segs.length - 1) {
          const len = frames - acc;
          return len > 0
            ? len
            : Math.max(4, Math.round(frames / Math.max(1, segs.length)));
        }
        let len: number;
        if (hasSegDuration) {
          const d = segControl[i]?.duration;
          len = typeof d === 'number' && d > 0 ? Math.max(4, Math.round((d * frames) / durTotal)) : Math.max(4, Math.round(frames / Math.max(1, segs.length)));
        } else {
          const origLen =
            typeof s.length === 'number'
              ? s.length
              : typeof s.frameCount === 'number'
                ? s.frameCount
                : 0;
          len = Math.max(4, Math.round((origLen * frames) / origTotal));
        }
        acc += len;
        return len;
      });
      let cursor = 0;
      segs.forEach((s, i) => {
        s.length = newLengths[i];
        s.frameCount = newLengths[i];
        s.durationSec = Math.max(1, Math.round(newLengths[i] / VIDEO_FPS));
        s.start = cursor;
        if (typeof s._videoFrameCount === 'number') {
          s._videoFrameCount = newLengths[i];
        }
        cursor += newLengths[i];
      });
      // batchWorkspaces 各模式段（t2v/r2v/mixed）保持同样的帧数/起点重排。
      const batch = asRecord(timeline.batchWorkspaces);
      if (batch) {
        for (const [, ws] of Object.entries(batch)) {
          const wsRec = asRecord(ws);
          if (!wsRec || !Array.isArray(wsRec.segments)) continue;
          const wsSegs = wsRec.segments;
          let bCursor = 0;
          wsSegs.forEach((s, i) => {
            const seg = asRecord(s);
            if (!seg) return;
            const len =
              i < newLengths.length
                ? newLengths[i]
                : Math.max(4, Math.round(frames / Math.max(1, wsSegs.length)));
            seg.length = len;
            seg.frameCount = len;
            seg.durationSec = Math.max(1, Math.round(len / VIDEO_FPS));
            seg.start = bCursor;
            if (typeof seg._videoFrameCount === 'number') {
              seg._videoFrameCount = len;
            }
            bCursor += len;
          });
        }
      }
      timeline.totalFrames = frames;
      timeline.frameRate = VIDEO_FPS;
      timeline.width = size.width;
      timeline.height = size.height;
      const output = asRecord(timeline.output);
      if (output) {
        output.width = size.width;
        output.height = size.height;
      }
      nodeInputs.total_frames = frames;
    }
    const global = asRecord(timeline.global);
    if (global) {
      global.prompt = effectivePrompt;
      if (resolvedTaskType) global.taskType = resolvedTaskType;
    }
    // 多段生成：强制启用"参考上一段末尾 22 帧"衔接（r2v 参考主体 + 段间连续性），
    // 无论模板段是否自带 continuityFromPrev / continuityEnabled。
    if (isMultiSegment) {
      for (const seg of segments) {
        const segment = asRecord(seg);
        if (segment) segment.continuityFromPrev = true;
      }
      const batch = asRecord(timeline.batchWorkspaces);
      if (batch) {
        for (const [, ws] of Object.entries(batch)) {
          const wsRec = asRecord(ws);
          if (wsRec && Array.isArray(wsRec.segments)) {
            for (const seg of wsRec.segments) {
              const segment = asRecord(seg);
              if (segment) segment.continuityFromPrev = true;
            }
          }
        }
      }
      const output = asRecord(timeline.output);
      if (output) {
        output.continuityEnabled = true;
        output.continuityOverlapFrames = 22;
      }
    }
    const first = segments.length > 0 ? asRecord(segments[0]) : null;
    if (first && !isMultiSegment) {
      first.length = frames;
      first.frameCount = frames;
      first.durationSec = Math.round(frames / VIDEO_FPS);
      // 界面提供了提示词时，无条件覆盖段 prompt（不用模板预设文案）。
      if (userPrompt) first.prompt = effectivePrompt;
      // 单段：batchWorkspaces 各模式段同步帧数——Director 按 task_type 路由对应模式段，
      // 若不同步会沿用模板残留时长（如 124/243 帧），导致界面秒数不生效。
      const batch = asRecord(timeline.batchWorkspaces);
      if (batch) {
        for (const [, ws] of Object.entries(batch)) {
          const wsRec = asRecord(ws);
          if (wsRec && Array.isArray(wsRec.segments)) {
            for (const seg of wsRec.segments) {
              const segment = asRecord(seg);
              if (segment) {
                segment.length = frames;
                segment.frameCount = frames;
                segment.durationSec = Math.round(frames / VIDEO_FPS);
                if (typeof segment._videoFrameCount === 'number') {
                  segment._videoFrameCount = frames;
                }
              }
            }
          }
        }
      }
    }
    // 单段/多段：界面提供了提示词时，覆盖每一段的 prompt（含所有 batchWorkspaces 模式段），
    // 否则生成会沿用模板自带的分镜示例文案，导致画面与界面提示词不一致。
    // 界面逐段控制（segments 参数）：第 i 段提示词非空则覆盖该段，否则用全局提示词。
    if (userPrompt) {
      const segControl = Array.isArray(segments) ? segments : [];
      const segmentPromptAt = (i: number) => {
        const custom = segControl[i]?.prompt;
        return typeof custom === 'string' && custom.trim()
          ? custom.trim()
          : effectivePrompt;
      };
      for (let i = 0; i < segments.length; i++) {
        const segment = asRecord(segments[i]);
        if (segment) segment.prompt = segmentPromptAt(i);
      }
      const batch = asRecord(timeline.batchWorkspaces);
      if (batch) {
        for (const [, ws] of Object.entries(batch)) {
          const wsRec = asRecord(ws);
          if (wsRec && Array.isArray(wsRec.segments)) {
            for (let i = 0; i < wsRec.segments.length; i++) {
              const segment = asRecord(wsRec.segments[i]);
              if (segment) segment.prompt = segmentPromptAt(i);
            }
          }
        }
      }
    }
    const gen = asRecord(timeline.gen);
    if (gen) gen.defaultFrameCount = frames;
    nodeInputs.timeline_data = JSON.stringify(timeline);
  } catch {
    // timeline_data 解析失败时保留模板原值，仅注入独立字段。
  }
}

/** 把像素宽高比映射到最近的 Qwen 比例枚举 key（编辑默认跟随参考图用）。 */
function nearestAspectRatioKey(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '1:1';
  const candidates = [
    '1:1',
    '4:3',
    '3:4',
    '16:9',
    '9:16',
    '21:9',
    '9:21',
    '5:4',
    '4:5',
    '2:3',
    '3:2',
    '2:1',
    '1:2',
    '3:1',
    '1:3',
  ];
  const target = width / height;
  let best = '1:1';
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    const [rw, rh] = candidate.split(':').map(Number);
    if (!rw || !rh) continue;
    const diff = Math.abs(target - rw / rh);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

/**
 * 把一次生成任务注入 ComfyUI 的 API-format workflow。
 * 模板文件里的 `_beatdesign` 元信息在提交前剥离，不会发给 ComfyUI。
 */
function compileComfyUiPrompt(
  workflow: ComfyUiWorkflow,
  input: Record<string, unknown>,
  refSize?: { width: number; height: number } | null
): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  for (const [nodeId, value] of Object.entries(workflow)) {
    if (nodeId.startsWith('_')) continue;
    // 防御性剥离付费云 API 节点（旧模板/未来模板可能残留）。
    // CreateVideo/SaveVideo 是本地视频合成+保存链，予以保留。
    const cls = asRecord(value)?.class_type;
    if (
      cls &&
      (cls === 'MiniMaxH3API' ||
        cls === 'MinimaxAPI' ||
        cls === 'MiniMaxH3APITextToVideo' ||
        cls === 'MiniMaxH3APIImagesToVideo' ||
        cls === 'MiniMaxH3APIAudioToVideo' ||
        cls === 'MiniMaxH3APIVideoToVideo' ||
        cls === 'MiniMaxH3APIReferenceToVideo')
    ) {
      continue;
    }
    nodes[nodeId] = value;
  }
  const meta = workflow._beatdesign ?? {};
  const prompt = readString(input.prompt) ?? '';
  const frames = framesFromDuration(input.duration);
  const aspectRatio = readString(input.aspect_ratio);

  const resolveSize = (nodeInputs: Record<string, unknown>) => {
    const isVideoSize =
      'num_frames' in nodeInputs || 'total_frames' in nodeInputs;
    if (isVideoSize) {
      const fallback = '16:9';
      return aspectRatio
        ? VIDEO_ASPECT_RATIO_SIZES[aspectRatio] ??
            VIDEO_ASPECT_RATIO_SIZES[fallback]
        : VIDEO_ASPECT_RATIO_SIZES[fallback];
    }
    // 图片：自定义分辨率（宽×高）优先；否则分辨率档位（1k/2k/4k）决定长边，比例决定短边（32 对齐）。
    const customWidth = Number.parseInt(String(input.custom_width ?? ''), 10);
    const customHeight = Number.parseInt(String(input.custom_height ?? ''), 10);
    if (customWidth > 0 && customHeight > 0) {
      return {
        width: Math.max(64, Math.round(customWidth / 32) * 32),
        height: Math.max(64, Math.round(customHeight / 32) * 32),
      };
    }
    const quality =
      readString(input.wmOutputQuality) ?? readString(input.output_quality) ?? '';
    const longEdge = IMAGE_QUALITY_LONG_EDGES[quality];
    if (longEdge) {
      const ratio =
        aspectRatio && /^\d+:\d+$/.test(aspectRatio) ? aspectRatio : '1:1';
      const [rw, rh] = ratio.split(':').map(Number);
      if (!rw || !rh) return { width: longEdge, height: longEdge };
      const scale = longEdge / Math.max(rw, rh);
      const width = Math.max(64, Math.round((rw * scale) / 32) * 32);
      const height = Math.max(64, Math.round((rh * scale) / 32) * 32);
      return { width, height };
    }
    // 无分辨率档位的图片模型：沿用原比例映射。
    const fallback = '1:1';
    return aspectRatio
      ? ASPECT_RATIO_SIZES[aspectRatio] ?? ASPECT_RATIO_SIZES[fallback]
      : ASPECT_RATIO_SIZES[fallback];
  };

  /** 已被 Director 分支整体注入过的节点 id，后续通用分支跳过。 */
  const directorInjected = new Set<string>();

  // `positive` 通常是一个节点 id，但多段串联的模板（AICG3D 无限分段）需要把
  // 同一个提示词写进每一段，所以允许写成逗号分隔的 id 列表。
  const positiveNodeIds = meta.positive
    ? String(meta.positive)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  for (const positiveNodeKey of positiveNodeIds) {
    const positiveNode = asRecord(nodes[positiveNodeKey]);
    const nodeInputs = asRecord(positiveNode?.inputs);
    if (positiveNode && nodeInputs) {
      if ('timeline_data' in nodeInputs) {
        // MiniMax H3 Director 一体式节点。
        const refImages = Array.isArray(input.image_urls)
          ? input.image_urls.filter(
              (item): item is string => typeof item === 'string'
            )
          : [];
        injectDirectorInputs(
          nodeInputs,
          prompt,
          frames,
          resolveSize(nodeInputs),
          typeof input.seed === 'number' || typeof input.seed === 'string'
            ? input.seed
            : undefined,
          Array.isArray(input.segments)
            ? (input.segments as DirectorSegmentControl[])
            : undefined,
          refImages.length
        );
        directorInjected.add(positiveNodeKey);
      } else if ('global_prompt' in nodeInputs) {
        nodeInputs.global_prompt = prompt;
      } else if ('text' in nodeInputs) {
        // CLIPTextEncode 用 text 字段。
        nodeInputs.text = prompt;
      } else if ('prompt' in nodeInputs) {
        // Qwen-Image 编码节点用 prompt 字段。
        nodeInputs.prompt = prompt;
        if ('resolution' in nodeInputs) {
          // Qwen 图像：输出分辨率（参考图缩放目标 / latent 长边）。
          const resolutionByQuality: Record<string, number> = {
            '1k': 1024,
            '2k': 2048,
            '4k': 4096,
          };
          const quality =
            readString(input.wmOutputQuality) ??
            readString(input.output_quality);
          if (quality && resolutionByQuality[quality]) {
            nodeInputs.resolution = resolutionByQuality[quality];
          } else {
            // 自定义分辨率：用长边作为 Qwen 编辑的缩放目标。
            const cw = Number.parseInt(String(input.custom_width ?? ''), 10);
            const ch = Number.parseInt(String(input.custom_height ?? ''), 10);
            if (cw > 0 || ch > 0) {
              nodeInputs.resolution = Math.max(cw, ch);
            }
          }
        }
        // Qwen 图像编辑：界面参考图数量少于模板图片槽时清空多余槽，
        // 避免继续使用模板内置的示例图。
        const referenceCount = Array.isArray(input.image_urls)
          ? input.image_urls.length
          : 0;
        if (referenceCount >= 0) {
          let slot = 2;
          while (slot <= 6) {
            const imageKey = `images.image_${slot}`;
            if (nodeInputs[imageKey] === undefined) break;
            if (referenceCount < slot) delete nodeInputs[imageKey];
            slot += 1;
          }
        }
      } else if ('lyrics_text' in nodeInputs) {
        // 音乐模板：composer 里的文本就是歌词。
        nodeInputs.lyrics_text = prompt;
      } else if ('positive_prompt' in nodeInputs) {
        // WanVideoTextEncode 用 positive_prompt 字段。
        nodeInputs.positive_prompt = prompt;
      }
    }
  }

  // 分辨率档位：AICG3D 全局设置节点上的 `resolution` 是字符串枚举
  // （360P…1080P），不是像素数，所以不能走 size 的宽高注入。界面的质量选项
  // 映射过去；映射不到就保留模板里的值，不猜。
  if (meta.resolution) {
    const resolutionInputs = asRecord(
      asRecord(nodes[String(meta.resolution).trim()])?.inputs
    );
    if (resolutionInputs && typeof resolutionInputs.resolution === 'string') {
      const quality = (
        readString(input.wmOutputQuality) ??
        readString(input.output_quality) ??
        ''
      ).toLowerCase();
      const resolutionByQuality: Record<string, string> = {
        '360p': '360P',
        '416p': '416P',
        '480p': '480P',
        '540p': '540P',
        '640p': '640P',
        '720p': '720P',
        '768p': '768P',
        '832p': '832P',
        '928p': '928P',
        '1024p': '1024P',
        '1080p': '1080P',
      };
      const mappedResolution = resolutionByQuality[quality];
      if (mappedResolution) resolutionInputs.resolution = mappedResolution;
    }
  }

  if (positiveNodeIds.length === 0) {
    // 启发式：注入到第一个含 text 字段的文本编码节点。
    const positiveNode = Object.entries(nodes).find(
      ([, value]) =>
        asRecord(value)?.class_type === 'CLIPTextEncode' &&
        asRecord(asRecord(value)?.inputs)?.text !== undefined
    );
    if (positiveNode) {
      const nodeInputs = asRecord(asRecord(positiveNode[1])?.inputs);
      if (nodeInputs) nodeInputs.text = prompt;
    }
  }

  const seed = input.seed;
  if (meta.seed && !directorInjected.has(meta.seed) && (typeof seed === 'number' || typeof seed === 'string')) {
    const samplerNode = asRecord(nodes[meta.seed]);
    const nodeInputs = asRecord(samplerNode?.inputs);
    if (samplerNode && nodeInputs) {
      nodeInputs.seed = Number(seed);
      if ('control_after_generate' in nodeInputs) {
        nodeInputs.control_after_generate = 'fixed';
      }
    }
  }

  if (meta.size && !directorInjected.has(meta.size)) {
    const latentNode = asRecord(nodes[meta.size]);
    const nodeInputs = asRecord(latentNode?.inputs);
    if (latentNode && nodeInputs) {
      const size = resolveSize(nodeInputs);
      const qwenRatios: Record<string, string> = {
        '1:1': '1:1 (Square)',
        '3:4': '3:4 (Portrait Standard)',
        '4:3': '4:3 (Standard)',
        '16:9': '16:9 (Widescreen)',
        '9:16': '9:16 (Portrait Widescreen)',
      };
      const megapixelsByQuality: Record<string, number> = {
        '1k': 1,
        '2k': 4,
        '4k': 16,
      };
      const quality =
        readString(input.wmOutputQuality) ??
        readString(input.output_quality) ??
        '1k';
      // 图像编辑默认（界面未选比例，auto/跟随参考图）：完整跟随参考图的
      // 原始分辨率与比例（不再缩到 1K 面积），编辑模型按参考图尺寸输出；
      // 用户明确选择比例/分辨率时才走下方映射。
      const refAuto =
        (!aspectRatio || aspectRatio === 'auto') &&
        !!refSize &&
        refSize.width > 0 &&
        refSize.height > 0;
      let targetWidth: number;
      let targetHeight: number;
      if (refAuto) {
        // 原始分辨率（32 对齐），与参考图大小完全一致。
        targetWidth = Math.max(64, Math.round(refSize.width / 32) * 32);
        targetHeight = Math.max(64, Math.round(refSize.height / 32) * 32);
        nodeInputs.width = targetWidth;
        nodeInputs.height = targetHeight;
        if ('aspect_ratio' in nodeInputs) {
          nodeInputs.aspect_ratio =
            qwenRatios[nearestAspectRatioKey(refSize.width, refSize.height)] ??
            qwenRatios['1:1'];
          // 面积档取参考图真实百万像素（1024² 基准，保留小数，不向上取整）。
          // EmptyLatentImage 按 aspect_ratio + megapixels 反算宽高：
          //   3:4 @ 1MP   -> 896×1184（之前 Math.round(0.79)=1 的错误放大）
          //   3:4 @ 0.786 -> 768×1024（与参考图完全一致）
          nodeInputs.megapixels = Math.max(
            0.1,
            (refSize.width * refSize.height) / (1024 * 1024)
          );
        }
      } else {
        targetWidth = size.width;
        targetHeight = size.height;
        if ('aspect_ratio' in nodeInputs) {
          // Qwen Image / Resolution 风格 EmptyLatentImage：比例枚举 + 总像素档位。
          const ratioKey =
            aspectRatio && qwenRatios[aspectRatio] ? aspectRatio : '1:1';
          nodeInputs.aspect_ratio = qwenRatios[ratioKey];
          nodeInputs.megapixels = megapixelsByQuality[quality] ?? 1;
        }
        nodeInputs.width = targetWidth;
        nodeInputs.height = targetHeight;
      }
      // 同步 TextEncodeQwenImage21 的 resolution：它会把参考图缩放到约
      // resolution×resolution（保比例、32 对齐）并以此为视觉槽位/潜在尺寸
      // 基准。若仍用模板默认 1024，文本编码器看到的参考图尺寸（如
      // 896×1184）会与采样 latent（768×1024）不一致，导致分辨率语义混乱。
      //   跟随参考图 -> 0（保留参考图原尺寸，32 对齐后与 latent 完全一致）
      //   明确比例   -> 目标面积几何平均（32 对齐），视觉槽贴近采样尺寸
      // 多段模板里 positive 可能是逗号列表，取第一个用于分辨率回填。
      const positiveNodeId = readString(meta.positive)?.split(',')[0]?.trim();
      const positiveInputs = positiveNodeId
        ? asRecord(asRecord(nodes[positiveNodeId])?.inputs)
        : null;
      if (positiveInputs && 'resolution' in positiveInputs) {
        positiveInputs.resolution = refAuto
          ? 0
          : Math.max(
              32,
              Math.round(Math.sqrt(targetWidth * targetHeight) / 32) * 32
            );
      }
    }
  }

  // 视频帧数（WanVideoEmptyEmbeds / WanVideoImageToVideoEncode 的 num_frames；
  // Director 的 total_frames 已在 Director 分支注入）。
  if (meta.video_frames && !directorInjected.has(meta.video_frames)) {
    const framesNode = asRecord(nodes[meta.video_frames]);
    const nodeInputs = asRecord(framesNode?.inputs);
    if (framesNode && nodeInputs) {
      if ('num_frames' in nodeInputs) {
        nodeInputs.num_frames = frames;
      } else if ('total_frames' in nodeInputs) {
        nodeInputs.total_frames = frames;
      }
    }
  }

  // 加速 LoRA（模板默认挂 8 步 Turbo/Acc LoRA；可在模板 _beatdesign.lora 覆盖）。
  const loraMeta = asRecord(meta.lora);
  if (loraMeta) {
    const loraNodeId = readString(loraMeta.node);
    const loraNode = loraNodeId ? asRecord(nodes[loraNodeId]) : null;
    const loraInputs = asRecord(loraNode?.inputs);
    if (loraInputs && loraNode?.class_type === 'LoraLoader') {
      const loraName = readString(loraMeta.name);
      if (loraName) loraInputs.lora_name = loraName;
      if (typeof loraMeta.strength === 'number') {
        loraInputs.strength_model = loraMeta.strength;
        loraInputs.strength_clip = loraMeta.strength;
      }
    }
  }

  return nodes;
}

/** 从本地项目资产 URL 解析 projectId/assetId。 */
const LOCAL_ASSET_URL_PATTERN =
  /\/api\/app\/projects\/([^/]+)\/assets\/([^/?]+)/;

async function readReferenceBytes(url: string): Promise<{
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}> {
  const localMatch = url.match(LOCAL_ASSET_URL_PATTERN);
  if (localMatch) {
    const { readFile } = await import('node:fs/promises');
    const { getProjectAssetById } = await import(
      '@/core/workspace-lib/assets/user-assets'
    );
    const { resolveLocalProjectAssetPath } = await import(
      '@/core/projects/local-project-assets'
    );
    const [, projectId, assetId] = localMatch;
    const asset = await getProjectAssetById({ projectId, assetId });
    if (!asset) throw new Error(`Reference asset ${assetId} is not available.`);
    if (asset.storageProvider !== 'local' || !asset.objectKey) {
      throw new Error('Reference asset is not stored locally for ComfyUI delivery.');
    }
    const filePath = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
    const bytes = new Uint8Array(await readFile(filePath));
    const mimeType =
      asset.mimeType?.split(';')[0]?.trim() ||
      (asset.type === 'video' ? 'video/mp4' : 'image/png');
    return { bytes, filename: asset.filename || `${asset.id}.png`, mimeType };
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to read reference media (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
  const mimeType = contentType || 'image/png';
  const parsedUrl = new URL(url);
  const queryFilename = readString(parsedUrl.searchParams.get('filename'));
  const pathFilename = decodeURIComponent(parsedUrl.pathname.split('/').pop() || '');
  const filename = queryFilename || pathFilename || 'reference.png';
  return { bytes, filename, mimeType };
}

/** 图像编辑参考图按目标宽高比居中补边（黑边）的 python 脚本。 */
const PAD_PYTHON_SCRIPT = `
from PIL import Image
import sys
src, dst, ratio = sys.argv[1], sys.argv[2], sys.argv[3]
rw, rh = map(int, ratio.split(':'))
im = Image.open(src).convert('RGB')
w, h = im.size
m = 32
target = rw / rh
cur = w / h
if cur > target:
    new_w = w
    new_h = max(m, round(w / target / m) * m)
else:
    new_h = h
    new_w = max(m, round(h * target / m) * m)
canvas = Image.new('RGB', (new_w, new_h), (0, 0, 0))
canvas.paste(im, ((new_w - w) // 2, (new_h - h) // 2))
canvas.save(dst)
`;

/**
 * 用 PIL 读取图片像素宽高，输出 "W H"。用于图像编辑默认跟随参考图比例。
 */
const READ_SIZE_PYTHON_SCRIPT = `
from PIL import Image
import sys
im = Image.open(sys.argv[1])
print(f"{im.width} {im.height}")
`;

/**
 * 下载参考图并用 PIL 读取宽高；找不到可用 python（无 PIL）或失败时返回 null。
 */
async function readReferenceImageSize(
  imageUrl: string,
  pythonHints: string[]
): Promise<{ width: number; height: number } | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const execFileAsync = promisify(execFile);
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const tmpDir = await mkdtemp(join(tmpdir(), 'bd-size-'));
    try {
      const srcPath = join(tmpDir, 'ref.png');
      await writeFile(srcPath, bytes);
      for (const py of pythonHints) {
        if (!py) continue;
        try {
          await execFileAsync(py, ['-c', 'from PIL import Image'], {
            timeout: 8_000,
          });
          const { stdout } = await execFileAsync(
            py,
            ['-c', READ_SIZE_PYTHON_SCRIPT, srcPath],
            { timeout: 20_000 }
          );
          const match = stdout.trim().match(/^(\d+)\s+(\d+)/);
          if (match) {
            return { width: Number(match[1]), height: Number(match[2]) };
          }
        } catch {
          // 尝试下一个 python 候选。
        }
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    // 读尺寸失败时调用方回退 1:1。
  }
  return null;
}

/**
 * 用 PIL 把参考图按目标宽高比居中补边。返回处理后的 bytes 与文件名；
 * 找不到可用 python（无 PIL）或处理失败时返回 null（调用方回退原图）。
 */
async function tryPadImageToAspectRatio(
  bytes: Uint8Array,
  filename: string,
  aspectRatio: string,
  pythonHints: string[]
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  // 动态 import（适配器会被浏览器端加载，node: 模块不能在顶层引入）。
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { extname, join } = await import('node:path');
  const execFileAsync = promisify(execFile);
  if (!/^\d+:\d+$/.test(aspectRatio)) return null;
  const tmpDir = await mkdtemp(join(tmpdir(), 'bd-pad-'));
  try {
    const srcPath = join(tmpDir, `src${extname(filename) || '.png'}`);
    const dstPath = join(tmpDir, 'dst.png');
    await writeFile(srcPath, bytes);
    for (const py of pythonHints) {
      if (!py) continue;
      try {
        await execFileAsync(py, ['-c', 'from PIL import Image'], {
          timeout: 8_000,
        });
        await execFileAsync(
          py,
          ['-c', PAD_PYTHON_SCRIPT, srcPath, dstPath, aspectRatio],
          { timeout: 30_000 }
        );
        const out = await readFile(dstPath);
        return {
          bytes: new Uint8Array(out),
          filename: `pad-${filename.replace(/\.[^.]+$/, '')}.png`,
        };
      } catch {
        // 尝试下一个 python 候选。
      }
    }
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 上传图片 bytes 到 ComfyUI input/，返回文件名。 */
async function uploadReferenceImageBytes(
  baseUrl: string,
  bytes: Uint8Array,
  filename: string,

  mimeType: string,
  maxBytes: number = MAX_LOCAL_IMAGE_ASSET_BYTES
): Promise<string> {
  if (bytes.byteLength > maxBytes) {
    throw new Error('Reference image is too large to upload to ComfyUI.');
  }
  const form = new FormData();
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  form.append('image', new Blob([blobBytes], { type: mimeType }), filename);
  const response = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`ComfyUI upload failed (${response.status}).`);
  }
  const payload = asRecord(await readBoundedJson(response));
  const name = readString(payload?.name);
  if (!name) throw new Error('ComfyUI upload did not return an image name.');
  return name;
}

async function uploadReferenceImage(
  baseUrl: string,
  url: string
): Promise<string> {
  const { bytes, filename, mimeType } = await readReferenceBytes(url);
  if (!mimeType.startsWith('image/')) {
    throw new Error(`ComfyUI image references require an image, got ${mimeType}.`);
  }
  return uploadReferenceImageBytes(baseUrl, bytes, filename, mimeType);
}

/**
 * 音频上传。ComfyUI 的 /upload/image 接受任意输入文件，但图片那条路径
 * 会检查 mime，音频得单独走一遍（上限用视频档，mp3 动辄几十 MB）。
 */
async function uploadReferenceAudio(
  baseUrl: string,
  url: string
): Promise<string> {
  const { bytes, filename, mimeType } = await readReferenceBytes(url);
  return uploadReferenceImageBytes(
    baseUrl,
    bytes,
    filename,
    mimeType,
    MAX_LOCAL_VIDEO_ASSET_BYTES
  );
}

/** 下载参考图 → 按目标宽高比补边 → 上传到 ComfyUI，返回文件名；失败回退原图。 */
async function padAndUploadReference(
  baseUrl: string,
  url: string,
  aspectRatio: string,
  pythonHints: string[]
): Promise<string | null> {
  const { bytes, filename, mimeType } = await readReferenceBytes(url);
  if (!mimeType.startsWith('image/')) return null;
  const padded = await tryPadImageToAspectRatio(
    bytes,
    filename,
    aspectRatio,
    pythonHints
  );
  if (!padded) return null;
  return uploadReferenceImageBytes(baseUrl, padded.bytes, padded.filename, 'image/png');
}

/** 上传参考视频（v2v/rv2v 源视频）到 ComfyUI input/，返回文件名。 */
async function uploadReferenceVideo(
  baseUrl: string,
  url: string
): Promise<string> {
  const { bytes, filename, mimeType } = await readReferenceBytes(url);
  if (!mimeType.startsWith('video/')) {
    throw new Error(`ComfyUI video references require a video, got ${mimeType}.`);
  }
  if (bytes.byteLength > MAX_LOCAL_VIDEO_ASSET_BYTES) {
    throw new Error('Reference video is too large to upload to ComfyUI.');
  }
  const form = new FormData();
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  form.append('image', new Blob([blobBytes], { type: mimeType }), filename);
  const response = await fetch(`${baseUrl}/upload/video`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // 旧版 ComfyUI 可能没有 /upload/video，回退到 /upload/image。
    const fallback = await fetch(`${baseUrl}/upload/image`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!fallback.ok) {
      throw new Error(`ComfyUI video upload failed (${response.status}/${fallback.status}).`);
    }
    const payload = asRecord(await readBoundedJson(fallback));
    const name = readString(payload?.name);
    if (!name) throw new Error('ComfyUI upload did not return a video name.');
    return name;
  }
  const payload = asRecord(await readBoundedJson(response));
  const name = readString(payload?.name);
  if (!name) throw new Error('ComfyUI upload did not return a video name.');
  return name;
}

/**
 * 把上传后的参考图写入 Director 的 timeline_data。
 * - r2v（timeline 含 segments[].refs）：全部图写为 refs（<Picture N> 参考）。
 * - fl2v/i2v：首图写 genImage.imageFile（首帧），第二图写 endImage.imageFile（尾帧）。
 */
function injectDirectorReferenceMedia(
  nodeInputs: Record<string, unknown>,
  imageNames: string[]
): void {
  const timelineRaw = nodeInputs.timeline_data;
  if (typeof timelineRaw !== 'string' || !timelineRaw.trim()) return;
  try {
    const timeline = JSON.parse(timelineRaw) as Record<string, unknown>;
    const segments = Array.isArray(timeline.segments) ? timeline.segments : [];
    const first = segments.length > 0 ? asRecord(segments[0]) : null;
    // 界面参考图数量 + Director 任务类型决定注入形态：
    // - 1 张且非 fl2v/i2v = r2v 参考主体：全部段 refs 完全覆盖（含无 refs 数组的段补上）。
    // - 2 张及以上 或 fl2v/i2v = 首尾帧：首图 genImage、尾图 endImage，refs 清空避免残留干扰。
    const taskType = readString(nodeInputs.task_type) ?? '';
    // 首尾帧（fl2v/i2v）才按"首帧+尾帧"注入；其余（r2v 参考主体 / t2v 切 r2v）
    // 一律把全部参考图写进 refs（<Picture N>），否则多图参考会被当作首尾帧清空 refs，
    // 导致参考主体模式拿不到任何参考图（表现如同文生视频）。
    const isFl2vLike = taskType.includes('fl2v') || taskType.includes('i2v');
    if (!isFl2vLike) {
      // r2v：参考主体图（支持多张 <Picture N>）。全部段 refs 同步，
      // 否则后续段仍引用模板自带的旧参考图。
      const refs = imageNames.map((name, index) => ({
        index,
        imageFile: name,
        fileName: name,
        type: 'input',
        subfolder: '',
      }));
      const applyRefs = (seg: unknown) => {
        const segment = asRecord(seg);
        if (!segment) return;
        if (!Array.isArray(segment.refs)) segment.refs = [];
        segment.refs = refs; // 完全覆盖：不用模板默认参考图。
      };
      for (const seg of segments) applyRefs(seg);
      const global = asRecord(timeline.global);
      if (global) global.refs = refs;
      const batch = asRecord(timeline.batchWorkspaces);
      if (batch) {
        for (const [, ws] of Object.entries(batch)) {
          const wsRec = asRecord(ws);
          if (wsRec && Array.isArray(wsRec.segments)) {
            for (const seg of wsRec.segments) applyRefs(seg);
          }
        }
      }
    } else {
      // fl2v / i2v：首帧 + 可选尾帧。
      const setImageFile = (
        holder: Record<string, unknown> | null,
        name: string
      ) => {
        if (holder) holder.imageFile = name;
      };
      const clearRefs = (seg: unknown) => {
        const segment = asRecord(seg);
        if (segment && Array.isArray(segment.refs)) segment.refs = [];
      };
      for (const seg of segments) clearRefs(seg);
      const batch = asRecord(timeline.batchWorkspaces);
      if (batch) {
        for (const [, ws] of Object.entries(batch)) {
          const wsRec = asRecord(ws);
          if (wsRec && Array.isArray(wsRec.segments)) {
            for (const seg of wsRec.segments) clearRefs(seg);
          }
        }
      }
      const global = asRecord(timeline.global);
      if (global) global.refs = [];
      setImageFile(asRecord(global?.genImage), imageNames[0] ?? '');
      if (first) {
        setImageFile(asRecord(first.genImage), imageNames[0] ?? '');
        if (imageNames.length > 1) {
          // 模板段可能没有 endImage 对象：补建再写尾帧。
          if (!first.endImage || typeof first.endImage !== 'object') {
            first.endImage = {
              imageFile: '',
              fileName: '',
              type: 'input',
              subfolder: '',
            };
          }
          setImageFile(asRecord(first.endImage), imageNames[1] ?? '');
          if (first.endImage) first.isEndFrame = true;
          if (first.isStartFrame === undefined) first.isStartFrame = true;
        }
      }
    }
    nodeInputs.timeline_data = JSON.stringify(timeline);
  } catch {
    // timeline_data 解析失败时仅保留独立字段注入。
  }
}

/** 把上传后的源视频写入 Director 的 timeline_data（v2v 源视频）。 */
function injectDirectorSourceVideo(
  nodeInputs: Record<string, unknown>,
  videoName: string
): void {
  const timelineRaw = nodeInputs.timeline_data;
  if (typeof timelineRaw !== 'string' || !timelineRaw.trim()) return;
  try {
    const timeline = JSON.parse(timelineRaw) as Record<string, unknown>;
    const video = asRecord(timeline.video);
    if (video) {
      video.fileName = videoName;
      video.videoFile = videoName;
      video.subfolder = '';
      video.type = 'input';
    }
    nodeInputs.timeline_data = JSON.stringify(timeline);
  } catch {
    // timeline_data 解析失败时忽略源视频注入。
  }
}

const mimeTypeForFilename = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'image/png';
};

/** 并行下载阶段暂存的一个 ComfyUI 输出媒体。 */
type DownloadedMedia = {
  viewUrl: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBufferLike>;
};

export class ComfyUiAdapter extends BaseAdapter {
  async createGeneration(input: unknown): Promise<GenerationResult> {
    try {
      const record = asRecord(input);
      if (!record || typeof readString(record.prompt) !== 'string') {
        return { status: 'failed', error: 'Prompt is required.' };
      }
      const { baseUrl, workflowDir, pythonPath } = await loadConfig();
      const workflow = await this.loadWorkflow({ workflowDir });

      const audioUrls = Array.isArray(record.audio_urls)
        ? record.audio_urls.filter(
            (item): item is string => typeof item === 'string'
          )
        : [];
      const imageUrls = Array.isArray(record.image_urls)
        ? record.image_urls.filter(
            (item): item is string => typeof item === 'string'
          )
        : [];
      const videoUrls = Array.isArray(record.video_urls)
        ? record.video_urls.filter(
            (item): item is string => typeof item === 'string'
          )
        : [];

      // 图像编辑默认（界面未选比例，auto/跟随参考图）：读参考图宽高，
      // 让 EmptyLatent 按参考图比例适配（编辑模型输出与参考图一致的比例）。
      const aspectRatioInput = readString(record.aspect_ratio);
      const isEditTemplate =
        !!workflow._beatdesign?.multi_image || !!workflow._beatdesign?.image;
      const pythonHints = [
        pythonPath?.trim() ?? '',
        process.env.BEATDESIGN_PYTHON?.trim() ?? '',
        'python',
        'python3',
        'py',
      ];
      let refSize: { width: number; height: number } | null = null;
      if (
        isEditTemplate &&
        imageUrls.length > 0 &&
        (!aspectRatioInput || aspectRatioInput === 'auto')
      ) {
        refSize = await readReferenceImageSize(imageUrls[0], pythonHints);
      }

      const nodes = compileComfyUiPrompt(workflow, record, refSize);

      // 音乐翻唱：把源音频推进 ComfyUI 的 input/，再把文件名写进切片节点。
      // 上传端点叫 /upload/image，但它接受任意输入文件，音频也走这里。
      const audioNodeId = workflow._beatdesign?.audio;
      if (audioNodeId && audioUrls.length > 0) {
        const audioNode = asRecord(nodes[audioNodeId]);
        const audioInputs = asRecord(audioNode?.inputs);
        if (audioInputs && 'audio' in audioInputs) {
          audioInputs.audio = await uploadReferenceAudio(baseUrl, audioUrls[0]);
        }
      }

      // 音乐风格参数：按字段名找风格节点（编译后的 prompt 不一定保留原 id，
      // 和 positive 一样用字段探测更稳）。不认识的键直接忽略。
      const styleParams = asRecord(record.style);
      if (styleParams) {
        for (const styleNode of Object.values(nodes)) {
          const styleInputs = asRecord(asRecord(styleNode)?.inputs);
          if (!styleInputs || !('音乐风格' in styleInputs)) continue;
          for (const [key, value] of Object.entries(styleParams)) {
            if (!(key in styleInputs)) continue;
            if (typeof value === 'string' || typeof value === 'number') {
              styleInputs[key] = value;
            }
          }
          break;
        }
      }

      // Qwen21MultiImageLoader（多参考图图像编辑）：全部图上传并写入 image_files 数组
      // （完全覆盖模板自带的残留参考图，避免"用户图 + 模板图"混用）。
      const multiImageNodeId = workflow._beatdesign?.multi_image;
      if (multiImageNodeId && imageUrls.length > 0) {
        const multiNode = asRecord(nodes[multiImageNodeId]);
        const multiInputs = asRecord(multiNode?.inputs);
        if (multiInputs && 'image_files' in multiInputs) {
          const names: string[] = [];
          for (const url of imageUrls.slice(0, 16)) {
            names.push(await uploadReferenceImage(baseUrl, url));
          }
          multiInputs.image_files = JSON.stringify(names);
          // 按实际参考图数量对齐 TextEncodeQwenImage21 的 images.image_N 连接：
          // 单图编辑时删除模板残留的 image_2；2 张以上时补齐 image_3..image_N。
          const positiveNodeId = workflow._beatdesign?.positive;
          const positiveInputs = positiveNodeId
            ? asRecord(asRecord(nodes[positiveNodeId])?.inputs)
            : null;
          if (positiveInputs) {
            const imageKeys = Object.keys(positiveInputs).filter((key) =>
              /^images\.image_\d+$/.test(key)
            );
            for (const key of imageKeys) {
              const idx = Number(key.split('image_')[1]);
              if (idx > names.length) delete positiveInputs[key];
            }
            for (let i = 3; i <= names.length; i++) {
              if (!(`images.image_${i}` in positiveInputs)) {
                positiveInputs[`images.image_${i}`] = [multiImageNodeId, i - 1];
              }
            }
          }
        }
      } else if (!multiImageNodeId && imageUrls.length > 0) {
        // 通用多图注入：编辑模板用 LoadImage（无 Qwen21MultiImageLoader）时，
        // 覆盖模板预留 LoadImage 的文件名，并按需克隆新 LoadImage 节点补足
        // images.image_N 连接，确保每一张上传图都参与编辑编码。
        const positiveNodeId = workflow._beatdesign?.positive;
        const positiveInputs = positiveNodeId
          ? asRecord(asRecord(nodes[positiveNodeId])?.inputs)
          : null;
        if (positiveInputs) {
          const imageKeys = Object.keys(positiveInputs)
            .filter((key) => /^images\.image_\d+$/.test(key))
            .sort(
              (a, b) => Number(a.split('image_')[1]) - Number(b.split('image_')[1])
            );
          const names: string[] = [];
          for (const url of imageUrls.slice(0, 16)) {
            names.push(await uploadReferenceImage(baseUrl, url));
          }
          let loadCounter = 5000;
          imageKeys.forEach((key, slot) => {
            if (slot + 1 > names.length) {
              delete positiveInputs[key];
              return;
            }
            const conn = positiveInputs[key];
            const srcId = Array.isArray(conn) ? conn[0] : null;
            const srcNode = srcId ? asRecord(nodes[srcId]) : null;
            if (srcNode && srcNode.class_type === 'LoadImage') {
              const srcInputs = asRecord(srcNode.inputs);
              if (srcInputs) srcInputs.image = names[slot];
            }
          });
          // 补足第 3 张及以后（模板通常只预留 image_1/image_2 两个 LoadImage）。
          for (let i = imageKeys.length + 1; i <= names.length; i++) {
            const newId = String(loadCounter++);
            nodes[newId] = {
              class_type: 'LoadImage',
              inputs: { image: names[i - 1] },
            };
            positiveInputs[`images.image_${i}`] = [newId, 0];
          }
        }
      }

      // 找参考图/源视频的注入目标：优先 _beatdesign.image 指定的节点，
      // 否则找 LoadImage；Director 节点（含 timeline_data）接收多图/视频。
      const mediaNode =
        (() => {
          const imageNodeId = workflow._beatdesign?.image;
          if (imageNodeId) return asRecord(nodes[imageNodeId]) ?? null;
          return (
            Object.entries(nodes)
              .map(([, value]) => asRecord(value))
              .find(
                (node) =>
                  node &&
                  (node.class_type === 'LoadImage' ||
                    asRecord(node.inputs)?.timeline_data !== undefined)
              ) ?? null
          );
        })();
      if (mediaNode) {
        const nodeInputs = asRecord(mediaNode.inputs);
        if (nodeInputs) {
          if ('timeline_data' in nodeInputs) {
            // MiniMax H3 Director：图生视频（首帧/尾帧）、参考主体、源视频。
            if (imageUrls.length > 0) {
              const names: string[] = [];
              for (const url of imageUrls) {
                names.push(await uploadReferenceImage(baseUrl, url));
              }
              injectDirectorReferenceMedia(nodeInputs, names);
            }
            if (videoUrls.length > 0) {
              const name = await uploadReferenceVideo(baseUrl, videoUrls[0]);
              injectDirectorSourceVideo(nodeInputs, name);
            }
          } else if (imageUrls.length > 0) {
            // LoadImage 图生图：首张参考图。
            const firstImageUrl = imageUrls[0];
            const aspectRatio = readString(record.aspect_ratio);
            const customW = Number.parseInt(String(record.custom_width ?? ''), 10);
            const customH = Number.parseInt(String(record.custom_height ?? ''), 10);
            const padRatio =
              customW > 0 && customH > 0
                ? `${customW}:${customH}`
                : aspectRatio;
            // Qwen 图像编辑：界面选了非 1:1 比例时，把参考图按目标比例补边后上传，
            // 使编辑输出比例与界面选择一致（编辑模型本身按参考图比例缩放）。
            let name: string;
            const imageNodeId = workflow._beatdesign?.image;
            const pythonHints = [
              pythonPath?.trim() ?? '',
              process.env.BEATDESIGN_PYTHON?.trim() ?? '',
              'python',
              'python3',
              'py',
            ];
            const padded =
              imageNodeId && padRatio && padRatio !== '1:1'
                ? await padAndUploadReference(
                    baseUrl,
                    firstImageUrl,
                    padRatio,
                    pythonHints
                  )
                : null;
            name =
              padded ?? (await uploadReferenceImage(baseUrl, firstImageUrl));
            nodeInputs.image = name;
          }
        }
      }

      const response = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: nodes,
          // ComfyUI routes progress events to the socket registered under this
          // id, so the progress module connects with the same constant.
          client_id: COMFYUI_CLIENT_ID,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`ComfyUI prompt submission failed (${response.status}).`);
      }
      const payload = asRecord(await readBoundedJson(response));
      const promptId = readString(payload?.prompt_id);
      if (!promptId) {
        const errors = payload?.node_errors;
        const detail = errors && asRecord(errors)
          ? Object.keys(asRecord(errors)!).join(', ')
          : 'no prompt_id';
        return {
          status: 'failed',
          error: `ComfyUI rejected the workflow (${detail}).`,
          output: { provider: 'comfyui' },
        };
      }
      return {
        status: 'processing',
        output: { taskId: promptId, provider: 'comfyui', promptId },
      };
    } catch (cause) {
      return {
        status: 'failed',
        error: cause instanceof Error ? cause.message : 'ComfyUI request failed',
      };
    }
  }

  async checkStatus(taskId: string): Promise<GenerationResult> {
    try {
      const { baseUrl } = await loadConfig();
      const response = await fetch(
        `${baseUrl}/history/${encodeURIComponent(taskId)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      );
      if (!response.ok) {
        return { status: 'processing', output: { taskId, provider: 'comfyui' } };
      }
      const payload = asRecord(await readBoundedJson(response));
      const entry = asRecord(payload?.[taskId]) as ComfyUiHistoryEntry | null;
      if (!entry) {
        return { status: 'processing', output: { taskId, provider: 'comfyui' } };
      }
      const status = entry.status ?? null;
      if (status?.status_str === 'error') {
        const messages = asRecordArray(status.messages ?? [])
          .map((item) => readString(item.message))
          .filter((item): item is string => Boolean(item));
        return {
          status: 'failed',
          error: messages[0] ?? 'ComfyUI task failed.',
          output: { taskId, provider: 'comfyui' },
        };
      }

      const mediaRefs: ComfyUiImageRef[] = [];
      for (const node of Object.values(entry.outputs ?? {})) {
        mediaRefs.push(
          ...(node?.images ?? []),
          ...(node?.gifs ?? []),
          ...(node?.videos ?? []),
          ...(node?.audio ?? [])
        );
      }
      if (mediaRefs.length === 0) {
        return { status: 'processing', output: { taskId, provider: 'comfyui' } };
      }

      const { getGenerationByProviderTaskId } = await import(
        '@/core/effects/record-generation'
      );
      const { persistLocalProjectAsset } = await import(
        '@/core/projects/local-project-assets'
      );
      const {
        LOCAL_PROJECT_ASSET_BUCKET,
        LOCAL_PROJECT_ASSET_PROVIDER,
      } = await import('@/core/projects/local-project-assets');
      const { linkGenerationAsset, recordUserAsset } = await import(
        '@/core/workspace-lib/assets/user-assets'
      );

      const generation = await getGenerationByProviderTaskId(taskId);
      if (!generation?.projectId) {
        return {
          status: 'failed',
          error: 'Generation project context is missing.',
          output: { taskId, provider: 'comfyui' },
        };
      }

      const seen = new Set<string>();
      // 并行下载全部输出（图片/视频），再串行持久化，
      // 避免多段视频/多图输出时逐张串行 fetch 拖慢回传。
      const downloads: (DownloadedMedia | null)[] = await Promise.all(
        mediaRefs
          .map((ref): Promise<DownloadedMedia | null> => {
            const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(
              ref.filename
            )}&subfolder=${encodeURIComponent(ref.subfolder ?? '')}&type=${encodeURIComponent(
              ref.type ?? 'output'
            )}`;
            if (seen.has(viewUrl)) return Promise.resolve(null);
            seen.add(viewUrl);
            return (async () => {
              try {
                const fileResponse = await fetch(viewUrl, {
                  signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
                if (!fileResponse.ok) return null;
                const bytes = new Uint8Array(await fileResponse.arrayBuffer());
                const mimeType = mimeTypeForFilename(ref.filename);
                const isVideo = mimeType.startsWith('video/');

                if (
                  bytes.byteLength === 0 ||
                  bytes.byteLength >
                    (isVideo
                      ? MAX_LOCAL_VIDEO_ASSET_BYTES
                      : MAX_LOCAL_IMAGE_ASSET_BYTES)
                ) {
                  return null;
                }
                return { viewUrl, filename: ref.filename, mimeType, bytes };
              } catch {
                return null;
              }
            })();
          })
          .filter((item) => item !== null)
      );

      const urls: string[] = [];
      for (const item of downloads) {
        if (!item) continue;
        const { viewUrl, filename, mimeType, bytes } = item;
        const isVideo = mimeType.startsWith('video/');
        const isAudio = mimeType.startsWith('audio/');
        const persisted = await persistLocalProjectAsset({
          projectId: generation.projectId,
          filename: filename || 'generated-media.png',
          mimeType,
          bytes,
        });
        await recordUserAsset({
          id: persisted.assetId,
          type: isVideo ? 'video' : isAudio ? 'audio' : 'image',
          source: 'provider',
          storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
          bucket: LOCAL_PROJECT_ASSET_BUCKET,
          objectKey: persisted.objectKey,
          publicUrl: persisted.publicUrl,
          filename: persisted.filename,
          mimeType,
          sizeBytes: persisted.sizeBytes,
          sha256: persisted.sha256,
          originProjectId: generation.projectId,
          metadata: {
            effectId: generation.effectId,
            generationId: generation.id,
            providerUrl: viewUrl,
          },
        });
        await linkGenerationAsset({
          generationId: generation.id,
          assetId: persisted.assetId,
          role: 'output',
        });
        urls.push(persisted.publicUrl);
      }
      if (urls.length === 0) {
        return {
          status: 'failed',
          error: 'ComfyUI completed but no media could be retrieved.',
          output: { taskId, provider: 'comfyui' },
        };
      }
      return {
        status: 'succeeded',
        output: {
          taskId,
          provider: 'comfyui',
          result_url: urls[0],
          resultUrls: urls,
          image_urls: urls,
          stored_result_url: urls[0],
          stored_result_urls: urls,
        },
      };
    } catch (cause) {
      return {
        status: 'failed',
        error: cause instanceof Error ? cause.message : 'ComfyUI status check failed',
      };
    }
  }

  private async loadWorkflow({
    workflowDir,
  }: {
    workflowDir: string;
  }): Promise<ComfyUiWorkflow> {
    const { readFile } = await import('node:fs/promises');
    const { isAbsolute, resolve } = await import('node:path');
    const config = await loadConfig();
    const modelId = this.effect.model || 'default';
    const configuredWorkflow = config.workflows?.[modelId]?.trim();
    const workflowPath = configuredWorkflow
      ? isAbsolute(configuredWorkflow)
        ? configuredWorkflow
        : resolve(await resolveDataRoot(), configuredWorkflow)
      : resolve(workflowDir, `${modelId}.json`);
    let raw: string;
    try {
      raw = await readFile(workflowPath, 'utf8');
    } catch {
      throw new Error(
        `ComfyUI workflow template not found for model "${modelId}". ` +
          `Expected ${workflowPath}. Export your ComfyUI workflow as API format into the workflow directory.`
      );
    }
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (!record) throw new Error(`ComfyUI workflow template ${workflowPath} is not a JSON object.`);
    return record as ComfyUiWorkflow;
  }
}

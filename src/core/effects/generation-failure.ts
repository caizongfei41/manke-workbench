/**
 * Turning a ComfyUI failure into something a person can act on.
 *
 * The renderer reports everything as a stack trace, a queue exception, or the string
 * "ComfyUI task failed." — none of which tells you whether to wait, fix a prompt, or install
 * a model. This maps the shapes we actually see to one sentence of advice and a code the UI
 * can style or translate.
 */

export type GenerationFailureCode =
  | 'queue-busy'
  | 'model-missing'
  | 'prompt-rejected'
  | 'out-of-memory'
  | 'timeout'
  | 'connection'
  | 'unknown';

export type GenerationFailure = {
  code: GenerationFailureCode;
  /** What happened, in one short clause. */
  title: string;
  /** What the user can do about it. */
  hint: string;
  /** The original text, so nothing is hidden when someone needs to dig. */
  raw: string;
};

const PATTERNS: Array<{ code: GenerationFailureCode; test: RegExp; title: string; hint: string }> = [
  {
    code: 'out-of-memory',
    test: /out of memory|OutOfMemory|CUDA error|allocation on device|OOM/i,
    title: '显存不够',
    hint: '降低分辨率或时长，或者先关掉别的占用显卡的程序再试。',
  },
  {
    code: 'model-missing',
    test: /CKPTLoader|CheckpointLoader|clip_name|vae_name|No such file or directory|not found in|model.*not.*exist|Value not in list/i,
    title: '缺少模型文件',
    hint: '这个工作流需要的模型没有装在这台机器上，检查 models 目录。',
  },
  {
    code: 'prompt-rejected',
    test: /prompt.*required|Prompt is required|validation failed|negative prompt|invalid prompt/i,
    title: '提示词被拒',
    hint: '换一种描述，或者去掉可能触发审核的词再试。',
  },
  {
    code: 'queue-busy',
    test: /queue.*full|QueueFull|already running|prompt_id.*in use/i,
    title: '队列已满',
    hint: '前面还有任务在跑，等它完成或清空队列后重试。',
  },
  {
    code: 'timeout',
    test: /timeout|timed out|超时/i,
    title: '渲染超时',
    hint: '这段比预期慢，可能模型在加载。直接重试通常就能过。',
  },
  {
    code: 'connection',
    test: /fetch failed|ECONNREFUSED|socket hang up|network|ENOTFOUND/i,
    title: '连不上渲染服务',
    hint: 'ComfyUI 可能没在跑，检查它是否在线。',
  },
];

/**
 * Best-effort classification. An unrecognised error is still returned — with the raw text
 * intact — because hiding it would be worse than not explaining it.
 */
export const classifyGenerationFailure = (raw: string | null | undefined): GenerationFailure => {
  const text = String(raw ?? '').trim();
  for (const pattern of PATTERNS) {
    if (pattern.test.test(text)) {
      return { code: pattern.code, title: pattern.title, hint: pattern.hint, raw: text };
    }
  }
  return {
    code: 'unknown',
    title: '生成失败',
    hint: '没有识别出具体原因，下面是原始信息。',
    raw: text || 'ComfyUI task failed.',
  };
};

/** One string for a toast or an inline note: "title：hint". */
export const formatGenerationFailure = (
  failure: { title?: string; hint?: string } | null | undefined,
  fallback: string | null | undefined
) => {
  if (failure?.title) return `${failure.title}：${failure.hint ?? ''}`;
  return fallback?.trim() || '生成失败';
};

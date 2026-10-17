// 本地 ComfyUI / 远程 BeatAPI 任务完成后的回传延迟由该间隔主导：
// 生成任务最多每 EFFECTS_POLL_INTERVAL_MS 毫秒向 provider 查询一次状态。
// 20s 会让本地任务"生成完 10-20 秒后才出现在画布"，降到 2s。
const DEFAULT_EFFECTS_POLL_INTERVAL_MS = 2_000;
const DEFAULT_EFFECTS_GENERATION_TIMEOUT_MS = 30 * 60 * 1000;

const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 1 && minutes * 60_000 === ms) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = Math.round(ms / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
};

export const EFFECTS_POLL_INTERVAL_MS = DEFAULT_EFFECTS_POLL_INTERVAL_MS;

export const EFFECTS_GENERATION_TIMEOUT_MS =
  DEFAULT_EFFECTS_GENERATION_TIMEOUT_MS;

export const EFFECTS_GENERATION_TIMEOUT_MESSAGE = `Task timed out after ${formatDuration(
  EFFECTS_GENERATION_TIMEOUT_MS
)}`;

export const isEffectsGenerationTimeoutError = (
  error: string | null | undefined
) => typeof error === 'string' && /^Task timed out after /i.test(error);

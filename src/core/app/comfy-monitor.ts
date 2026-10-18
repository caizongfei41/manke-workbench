/**
 * Live load and failure reading for the local ComfyUI.
 *
 * A long render gives no feedback beyond a spinner: is it stuck, is VRAM full, did
 * the graph fail on a missing node? These two helpers answer that from data the
 * server already exposes.
 */

export type ComfyMonitor = {
  reachable: boolean;
  running: number;
  pending: number;
  vramUsedGb: number | null;
  vramTotalGb: number | null;
  ramUsedGb: number | null;
  ramTotalGb: number | null;
  device: string | null;
  version: string | null;
};

const GB = 1024 ** 3;
const round = (value: number) => Math.round(value * 10) / 10;

export const parseComfyMonitor = ({
  queue,
  stats,
}: {
  queue?: unknown;
  stats?: unknown;
}): ComfyMonitor => {
  const q = queue as { queue_running?: unknown[]; queue_pending?: unknown[] } | undefined;
  const s = stats as
    | {
        system?: { ram_total?: number; ram_free?: number; comfyui_version?: string };
        devices?: { vram_total?: number; vram_free?: number; name?: string }[];
      }
    | undefined;

  const device = s?.devices?.[0];
  const vramTotal = device?.vram_total;
  const vramFree = device?.vram_free;
  const ramTotal = s?.system?.ram_total;
  const ramFree = s?.system?.ram_free;

  return {
    reachable: !!queue || !!stats,
    running: Array.isArray(q?.queue_running) ? q.queue_running.length : 0,
    pending: Array.isArray(q?.queue_pending) ? q.queue_pending.length : 0,
    vramTotalGb: typeof vramTotal === 'number' ? round(vramTotal / GB) : null,
    vramUsedGb:
      typeof vramTotal === 'number' && typeof vramFree === 'number'
        ? round((vramTotal - vramFree) / GB)
        : null,
    ramTotalGb: typeof ramTotal === 'number' ? round(ramTotal / GB) : null,
    ramUsedGb:
      typeof ramTotal === 'number' && typeof ramFree === 'number'
        ? round((ramTotal - ramFree) / GB)
        : null,
    device: device?.name ?? null,
    version: s?.system?.comfyui_version ?? null,
  };
};

export type GenerationFailureKind =
  | 'outOfMemory'
  | 'timeout'
  | 'missingNode'
  | 'missingModel'
  | 'cancelled'
  | 'invalidInput'
  | 'serverDown'
  | 'unknown';

/**
 * Name the failure instead of surfacing a raw stack.
 *
 * The point is to tell apart "the card ran out" (retry later, lower the resolution)
 * from "the template expects a node you do not have" (fix the install) — the two
 * produce a red line that reads the same today.
 */
export const classifyGenerationFailure = (
  message: string | null | undefined
): GenerationFailureKind => {
  const text = String(message ?? '').toLowerCase();
  if (!text) return 'unknown';

  // 服务掉线最容易被当成「未知失败」：任务凭空消失，界面上只有一行报错
  if (/econnrefused|fetch failed|socket hang up|connection refused|comfyui.*(down|unreachable)|未连接/.test(text)) {
    return 'serverDown';
  }
  if (/out of memory|outofmemory|cuda oom|allocation on device|显存不足/.test(text)) {
    return 'outOfMemory';
  }
  if (/timed out|timeout|超时|deadline exceeded/.test(text)) return 'timeout';
  if (/cancelled|canceled|interrupted|已取消|已中断/.test(text)) return 'cancelled';
  if (/cannot execute because|node .* does not exist|missing node|找不到节点|节点缺失/.test(text)) {
    return 'missingNode';
  }
  if (/no such file|not found|模型不存在|缺少模型|\.safetensors.*(missing|not found)/.test(text)) {
    return 'missingModel';
  }
  if (/invalid|must be|expected|参数|不合法/.test(text)) return 'invalidInput';
  return 'unknown';
};

/** Whether a failure is worth retrying as-is. */
export const isRetryableFailure = (kind: GenerationFailureKind) =>
  kind === 'outOfMemory' || kind === 'timeout' || kind === 'cancelled' || kind === 'unknown';

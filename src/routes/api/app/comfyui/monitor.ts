import { createFileRoute } from '@tanstack/react-router';

import { parseComfyMonitor } from '@/core/app/comfy-monitor';

/**
 * Live queue and VRAM from the local ComfyUI.
 *
 * Proxied rather than fetched from the browser so the page does not need to know
 * where ComfyUI lives, and so a missing server reads as "unreachable" instead of a
 * console error on every poll.
 */

const COMFY_URL = () =>
  (process.env.BEATDESIGN_COMFYUI_URL ?? 'http://127.0.0.1:8188').replace(/\/$/, '');

const fetchJson = async (path: string, timeoutMs = 2500) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${COMFY_URL()}${path}`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

async function GET() {
  const [queue, stats] = await Promise.all([
    fetchJson('/queue'),
    fetchJson('/system_stats'),
  ]);
  return Response.json(parseComfyMonitor({ queue, stats }));
}

export const Route = createFileRoute('/api/app/comfyui/monitor')({
  server: { handlers: { GET } },
});

// Track per-prompt execution progress from ComfyUI's WebSocket.
//
// ComfyUI exposes step progress only over `/ws`: `progress` events carry
// value/max, and `executing` events name the node currently running. No HTTP
// endpoint reports it, and `/history` only appears once the prompt has finished,
// so the local provider previously had no way to show anything but a spinner.
//
// One socket is kept for the whole process. Snapshots land in a module-level map
// so the status and project-generation routes can read them synchronously while
// building their responses.

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';

/**
 * The `client_id` every workbench submission carries.
 *
 * ComfyUI routes `progress` / `executing` events to the socket registered under
 * the submission's `client_id`. The adapter submits with this exact value, so
 * the progress socket must register under it too — a random id would connect
 * fine and then receive nothing.
 */
export const COMFYUI_CLIENT_ID = 'beatdesign';

/** What the prompt appears to be doing, derived from the events seen so far. */
export type ComfyUiProgressPhase =
  | 'queued'
  | 'working'
  | 'sampling'
  | 'decoding'
  | 'upscaling'
  | 'saving';

export type ComfyUiPromptProgress = {
  /** Completed steps of the current sampling node. */
  value: number;
  /** Total steps of the current sampling node. */
  max: number;
  /** 0..100, or null when the step count is not known yet. */
  percent: number | null;
  phase: ComfyUiProgressPhase;
  /** How long ago the snapshot was refreshed, in milliseconds. */
  ageMs: number;
};

type Snapshot = {
  value: number;
  max: number;
  phase: ComfyUiProgressPhase;
  updatedAt: number;
};

const snapshots = new Map<string, Snapshot>();

let socket: WebSocket | null = null;
let connecting = false;
let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer: NodeJS.Timeout | null = null;
let baseUrlOverride: string | null = null;

/** Node's built-in WebSocket, available from Node 22 onwards. */
const hasWebSocket = typeof globalThis.WebSocket === 'function';

/**
 * Resolve the ComfyUI address the same way the adapter does, without importing
 * it: env override first, then `data/comfyui.config.json`, then the default.
 */
async function resolveBaseUrl(): Promise<string> {
  if (baseUrlOverride) return baseUrlOverride;

  const fromEnv = process.env.BEATDESIGN_COMFYUI_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  try {
    const { getBeatDesignDataRoot } = await import('@/config/data-root');
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const configPath = resolve(
      getBeatDesignDataRoot(process.cwd()),
      'comfyui.config.json'
    );
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as {
      baseUrl?: string;
    };
    const configured = parsed.baseUrl?.trim();
    if (configured) return configured.replace(/\/+$/, '');
  } catch {
    // Missing or malformed config falls back to the default below.
  }
  return DEFAULT_BASE_URL;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  // Never keep the process alive just for the progress socket.
  reconnectTimer.unref?.();
}

function upsert(promptId: string, patch: Partial<Omit<Snapshot, 'updatedAt'>>) {
  const previous = snapshots.get(promptId);
  snapshots.set(promptId, {
    value: patch.value ?? previous?.value ?? 0,
    max: patch.max ?? previous?.max ?? 0,
    phase: patch.phase ?? previous?.phase ?? 'working',
    updatedAt: Date.now(),
  });
}

function handleMessage(raw: string) {
  let msg: { type?: string; data?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }
  const data = msg.data ?? {};
  const promptId = typeof data.prompt_id === 'string' ? data.prompt_id : null;
  if (!promptId) return;

  switch (msg.type) {
    case 'execution_start':
      upsert(promptId, { phase: 'queued' });
      return;
    case 'executing': {
      // `node === null` marks the end of a prompt.
      if (data.node === null || data.node === undefined) return;
      // The event carries a node id, not a class name, so keep whatever phase
      // is already known rather than guessing.
      upsert(promptId, {});
      return;
    }
    case 'progress': {
      const value = Number(data.value);
      const max = Number(data.max);
      // `progress` only fires from sampling nodes, so it is safe to say so.
      upsert(promptId, {
        value: Number.isFinite(value) ? value : 0,
        max: Number.isFinite(max) ? max : 0,
        phase: 'sampling',
      });
      return;
    }
    case 'execution_cached':
      upsert(promptId, { phase: 'working' });
      return;
    case 'execution_success':
    case 'execution_error':
      // The route reports the terminal state from /history; drop the snapshot.
      snapshots.delete(promptId);
      return;
    default:
      return;
  }
}

async function connect() {
  if (!hasWebSocket || connecting || socket) return;
  connecting = true;
  try {
    const base = await resolveBaseUrl();
    // Must match the `client_id` the adapter submits with, otherwise ComfyUI
    // routes the events to a sid no socket is registered under and they are lost.
    const ws = new WebSocket(
      `${base.replace(/^http/, 'ws')}/ws?clientId=${COMFYUI_CLIENT_ID}`
    );

    ws.addEventListener('open', () => {
      reconnectDelay = RECONNECT_BASE_MS;
      connecting = false;
    });
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') handleMessage(event.data);
    });
    ws.addEventListener('error', () => {
      connecting = false;
    });
    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      connecting = false;
      scheduleReconnect();
    });
    socket = ws;
  } catch {
    connecting = false;
    scheduleReconnect();
  }
}

/** Point the socket at a specific instance, or null to restore auto-detection. */
export function setComfyUiProgressBaseUrl(url: string | null) {
  baseUrlOverride = url;
  const current = socket;
  socket = null;
  try {
    current?.close();
  } catch {
    // Closing an already-dead socket is not an error here.
  }
}

/**
 * Mark which phase a prompt is expected to run.
 *
 * Callers that hold the workflow template can use this to label stages the
 * WebSocket cannot identify (it reports node ids, not node classes).
 */
export function noteComfyUiPromptPhase(
  promptId: string,
  phase: ComfyUiProgressPhase
) {
  if (!promptId) return;
  upsert(promptId, { phase });
}

/** Drop a snapshot early, e.g. when a submission is rejected outright. */
export function forgetComfyUiPrompt(promptId: string) {
  snapshots.delete(promptId);
}

/**
 * Progress for one ComfyUI prompt, or null when nothing is known.
 *
 * Opens the socket lazily and prunes expired snapshots, so callers do not need
 * a separate lifecycle step.
 */
export function getComfyUiPromptProgress(
  promptId: string | null | undefined
): ComfyUiPromptProgress | null {
  if (!promptId) return null;
  void connect();

  if (snapshots.size > 64) {
    const cutoff = Date.now() - SNAPSHOT_TTL_MS;
    for (const [id, snap] of snapshots) {
      if (snap.updatedAt < cutoff) snapshots.delete(id);
    }
  }

  const snap = snapshots.get(promptId);
  if (!snap) return null;
  return {
    value: snap.value,
    max: snap.max,
    percent:
      snap.max > 0 ? Math.min(100, Math.round((snap.value / snap.max) * 100)) : null,
    phase: snap.phase,
    ageMs: Date.now() - snap.updatedAt,
  };
}

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Prompt-enhance backend.
 *
 * Two modes, picked automatically:
 *
 *   remote  BEATDESIGN_LLM_BASE_URL points somewhere other than localhost,
 *           or BEATDESIGN_LLM_API_KEY is set. Nothing is spawned; the request
 *           goes straight to that OpenAI-compatible endpoint. This is the
 *           default path now that local llama.cpp is an optional extra.
 *
 *   local   base URL is localhost. The manager starts llama-server on demand
 *           and stops it after an idle period, so GPU memory is only used
 *           while the enhance button is actually in use.
 *
 * Env:
 *   BEATDESIGN_LLM_BASE_URL      OpenAI-compatible base URL
 *   BEATDESIGN_LLM_API_KEY       bearer token for the remote service
 *   BEATDESIGN_LLM_MODEL         model id to request
 *   BEATDESIGN_LLAMA_DIR         directory containing llama-server.exe (local)
 *   BEATDESIGN_LLAMA_MODEL       model GGUF path relative to that directory
 *   BEATDESIGN_LLM_IDLE_SECONDS  idle time before auto-stop (local, default 60)
 */
const DEFAULT_SERVER_DIR = 'C:\\llama-xiaofeng';
const DEFAULT_MODEL =
  'models\\Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf';
// Port is configurable because 8080 is a crowded default -- anything else
// bound there (an ESP32 audio server, a dev proxy) makes llama-server fail to
// bind and the manager then waits the full readiness timeout for a server that
// never started.
const DEFAULT_PORT = Number(process.env.BEATDESIGN_LLAMA_PORT) || 8081;

let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let configLoaded = false;

/**
 * Load data/llm.config.json into process.env once.
 *
 * Settings saved from the UI have to survive a restart, and the desktop
 * console offers no place to type an API key. Reading the file here keeps the
 * manager self-contained instead of importing the route that writes it.
 * Environment variables still win: they are checked first via ?? in the
 * accessors, and this only fills blanks.
 */
function loadStoredConfig(): void {
  if (configLoaded) return;
  configLoaded = true;
  try {
    let dir = dirname(new URL(import.meta.url).pathname);
    // Walk up to the repo root, then read data/llm.config.json.
    let root: string | null = null;
    for (let i = 0; i < 8; i += 1) {
      if (existsSync(join(dir, 'scripts', 'check-environment.mjs'))) {
        root = dir;
        break;
      }
      const parent = join(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    const base = root ?? process.cwd();
    const raw = readFileSync(join(base, 'data', 'llm.config.json'), 'utf8')
      .replace(/^\uFEFF/, '');
    const cfg = JSON.parse(raw) as { baseUrl?: string; apiKey?: string; model?: string };
    if (cfg.baseUrl && !process.env.BEATDESIGN_LLM_BASE_URL) {
      process.env.BEATDESIGN_LLM_BASE_URL = cfg.baseUrl;
    }
    if (cfg.apiKey && !process.env.BEATDESIGN_LLM_API_KEY) {
      process.env.BEATDESIGN_LLM_API_KEY = cfg.apiKey;
    }
    if (cfg.model && !process.env.BEATDESIGN_LLM_MODEL) {
      process.env.BEATDESIGN_LLM_MODEL = cfg.model;
    }
  } catch {
    // No config file yet: keep the env/default path.
  }
}

function serverDir(): string {
  return process.env.BEATDESIGN_LLAMA_DIR ?? DEFAULT_SERVER_DIR;
}

function modelPath(): string {
  return process.env.BEATDESIGN_LLAMA_MODEL ?? DEFAULT_MODEL;
}

/** Resolved base URL, without a trailing slash. */
export function baseUrl(): string {
  loadStoredConfig();
  const explicit = process.env.BEATDESIGN_LLM_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return `http://127.0.0.1:${DEFAULT_PORT}/v1`;
}

/** Bearer token for the remote service, if any. */
export function apiKey(): string | null {
  loadStoredConfig();
  const key = process.env.BEATDESIGN_LLM_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Is the configured endpoint a remote service rather than local llama-server?
 *
 * Decided by the host, not by whether a key is present: a self-hosted
 * llama.cpp behind a LAN address needs no key but still must not be spawned.
 */
export function isRemoteProvider(): boolean {
  loadStoredConfig();
  // An explicit key means remote even when the URL happens to be localhost
  // (a local proxy forwarding to a paid API, for example).
  if (apiKey()) return true;
  try {
    const host = new URL(baseUrl()).hostname;
    return !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
  } catch {
    // Unparseable URL: treat as remote so we never try to spawn for it.
    return true;
  }
}

function idleSeconds(): number {
  const raw = Number(process.env.BEATDESIGN_LLM_IDLE_SECONDS ?? 60);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

async function isServerUp(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Stop only the server instance we spawned ourselves; never touch one the user started manually. */
export function stopLlamaServer(): Promise<void> {
  return stopSpawnedServer();
}

async function stopSpawnedServer(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const proc = child;
  if (!proc) return;
  child = null;
  try {
    proc.kill();
  } catch {
    // process already exited
  }
  for (let i = 0; i < 30; i++) {
    if (!(await isServerUp(800))) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function waitUntilReady(timeoutMs = 240_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await stopSpawnedServer();
  throw new Error('llama-server did not become ready in time.');
}

/** Make sure the configured backend is reachable. */
export function ensureLlamaServer(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    // Remote mode: nothing to spawn. Just confirm the endpoint answers, and
    // report a clear reason when it does not (missing key, wrong URL, offline).
    if (isRemoteProvider()) {
      if (await isServerUp()) return;
      const url = baseUrl();
      throw new Error(
        apiKey()
          ? `连不上 AI 扩写服务：${url}。检查网络，或确认 BEATDESIGN_LLM_BASE_URL 填对了。`
          : `连不上 AI 扩写服务：${url}。如果需要 API key，请设置 BEATDESIGN_LLM_API_KEY。`
      );
    }

    if (await isServerUp()) return;
    if (child) {
      await waitUntilReady();
      return;
    }
    const dir = serverDir();
    const exe = `${dir}\\llama-server.exe`;
    const model = `${dir}\\${modelPath()}`;

    // Fail with an actionable message instead of letting spawn throw ENOENT.
    //
    // The default directory is a junction that points at a drive which is not
    // always mounted. When it is gone, spawn raises a bare ENOENT and the user
    // only sees "AI 扩写失败" with no idea that a whole directory vanished.
    // Naming the exact missing path and the env var that overrides it turns a
    // mystery into a one-line fix.
    if (!existsSync(exe)) {
      throw new Error(
        `找不到 llama-server.exe：${exe}\n` +
          `请确认 ${dir} 存在，或用环境变量 BEATDESIGN_LLAMA_DIR 指向 llama.cpp 所在目录。`
      );
    }
    if (!existsSync(model)) {
      throw new Error(
        `找不到本地模型：${model}\n` +
          `请把 GGUF 放进 ${dir}，或用 BEATDESIGN_LLAMA_MODEL 指定相对路径。`
      );
    }

    child = spawn(
      exe,
      [
        '-m',
        model,
        '-c',
        '8192',
        '--port',
        String(DEFAULT_PORT),
        '--host',
        '127.0.0.1',
        '--alias',
        'local-model',
        // Qwen3.6 defaults to thinking mode: with reasoning enabled the
        // OpenAI-compatible layer returns an empty `content` (all output goes
        // to the reasoning channel). Disable it so expand calls get real text.
        '--reasoning',
        'off',
      ],
      { cwd: dir, windowsHide: true }
    );
    child.stdout?.on('data', (data: Buffer) =>
      console.log('[llama-server]', String(data).trim())
    );
    child.stderr?.on('data', (data: Buffer) =>
      console.error('[llama-server]', String(data).trim())
    );
    child.on('exit', () => {
      child = null;
    });
    await waitUntilReady();
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** Reset the idle timer; call after every successful enhance request. */
export function refreshIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void stopSpawnedServer();
  }, idleSeconds() * 1000);
}

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Local llama.cpp server lifecycle manager.
 *
 * The llama-server is started on demand (first prompt-enhance call) and
 * stopped automatically after an idle period, so GPU memory is only used
 * while the enhance button is actually in use.
 *
 * Env overrides:
 *   BEATDESIGN_LLAMA_DIR         directory containing llama-server.exe
 *   BEATDESIGN_LLAMA_MODEL       model GGUF path relative to that directory
 *   BEATDESIGN_LLM_BASE_URL      OpenAI-compatible base URL (default :8080/v1)
 *   BEATDESIGN_LLM_IDLE_SECONDS  idle time before auto-stop (default 60)
 */
// Use an ASCII junction path: llama.cpp on Windows cannot read model files
// located under a non-ASCII directory (the argv path gets mojibake'd and the
// GGUF fails to load). C:\llama-xiaofeng is a directory junction pointing at
// the real llama-b9297-bin-win-cuda-13.1-x64 folder on Y:.
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

function serverDir(): string {
  return process.env.BEATDESIGN_LLAMA_DIR ?? DEFAULT_SERVER_DIR;
}

function modelPath(): string {
  return process.env.BEATDESIGN_LLAMA_MODEL ?? DEFAULT_MODEL;
}

function baseUrl(): string {
  return (
    process.env.BEATDESIGN_LLM_BASE_URL ??
    `http://127.0.0.1:${DEFAULT_PORT}/v1`
  ).replace(/\/+$/, '');
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

/** Make sure the local LLM server is running and reachable. */
export function ensureLlamaServer(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
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

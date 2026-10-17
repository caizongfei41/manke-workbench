import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { ensureLlamaServer, stopLlamaServer } from '@/core/adapters/llm-manager';

/**
 * Unified local service manager for the Manke workbench.
 *
 * Manages the three local services behind a single control surface:
 *   - workbench (this app, :3020)
 *   - ComfyUI   (:8188)
 *   - llama.cpp AI expander (:8080, lifecycle owned by llm-manager)
 *
 * ComfyUI is started headless (hidden window, logs to data/logs/comfyui.log)
 * so the user no longer has to keep a pile of CMD windows open. All
 * start/stop/status operations are exposed through /api/app/services and the
 * in-app Services console page.
 */

const WORKBENCH_PORT = 3020;
const COMFYUI_PORT = 8188;
const LLAMA_PORT = 8080;

const DEFAULT_COMFYUI_ROOT = 'E:\\ComfyUI';

let comfyChild: ChildProcess | null = null;
let comfyStarting: Promise<void> | null = null;
let comfyLogStream: ReturnType<typeof createWriteStream> | null = null;

function dataRoot(): string {
  return resolve(process.cwd(), 'data');
}

function logsDir(): string {
  return join(dataRoot(), 'logs');
}

export function comfyUiRoot(): string {
  const env = process.env.BEATDESIGN_COMFYUI_HOME?.trim();
  if (env) return env;
  const cwd = process.cwd();
  const candidates = [
    DEFAULT_COMFYUI_ROOT,
    resolve(cwd, '..', 'ComfyUI_XIAO-V1.0'),
    resolve(cwd, 'ComfyUI'),
  ];
  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, 'ComfyUI', 'main.py')) ||
      existsSync(join(candidate, 'run_nvidia_gpu.bat'))
    ) {
      return candidate;
    }
  }
  return DEFAULT_COMFYUI_ROOT;
}

export function comfyUiPython(): string {
  const root = comfyUiRoot();
  const candidates = [
    join(root, 'python_embeded', 'python.exe'),
    join(root, 'python', 'python.exe'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to the adapter's configured pythonPath when present.
  try {
    const configPath = join(dataRoot(), 'comfyui.config.json');
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
        pythonPath?: string;
      };
      if (raw.pythonPath && existsSync(raw.pythonPath)) return raw.pythonPath;
    }
  } catch {
    // ignore malformed config
  }
  return join(root, 'python_embeded', 'python.exe');
}

async function probe(port: number, timeoutMs = 1200): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export interface ServiceStatus {
  id: string;
  label: string;
  port: number;
  up: boolean;
  url: string;
  detail?: string;
}

export async function getServicesStatus(): Promise<{
  services: ServiceStatus[];
  comfyUiRoot: string;
  comfyUiPython: string;
  llamaManaged: boolean;
}> {
  const [comfyUp, llamaUp] = await Promise.all([
    probe(COMFYUI_PORT),
    probe(LLAMA_PORT),
  ]);
  // The workbench is this process, so it is up by definition.
  return {
    services: [
      {
        id: 'workbench',
        label: '漫客工作台',
        port: WORKBENCH_PORT,
        up: true,
        url: `http://127.0.0.1:${WORKBENCH_PORT}/zh`,
      },
      {
        id: 'comfyui',
        label: 'ComfyUI',
        port: COMFYUI_PORT,
        up: comfyUp,
        url: `http://127.0.0.1:${COMFYUI_PORT}`,
        detail: comfyUiRoot(),
      },
      {
        id: 'llama',
        label: 'AI 扩写 (llama.cpp)',
        port: LLAMA_PORT,
        up: llamaUp,
        url: `http://127.0.0.1:${LLAMA_PORT}`,
        detail: '按需启动，空闲自动停止',
      },
    ],
    comfyUiRoot: comfyUiRoot(),
    comfyUiPython: comfyUiPython(),
    llamaManaged: true,
  };
}

/** Start ComfyUI headless: hidden window, logs streamed to data/logs/comfyui.log. */
export function startComfyUi(): Promise<void> {
  if (comfyStarting) return comfyStarting;
  comfyStarting = (async () => {
    if (await probe(COMFYUI_PORT)) return;
    const root = comfyUiRoot();
    const python = comfyUiPython();
    if (!existsSync(python)) {
      throw new Error(`python 不存在: ${python}`);
    }
    const logDir = logsDir();
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'comfyui.log');
    comfyLogStream = createWriteStream(logPath, { flags: 'a' });
    comfyChild = spawn(
      python,
      ['-s', join('ComfyUI', 'main.py'), '--windows-standalone-build'],
      {
        cwd: root,
        windowsHide: true,
        detached: true,
      }
    );
    comfyChild.stdout?.on('data', (chunk: Buffer) => {
      comfyLogStream?.write(chunk);
    });
    comfyChild.stderr?.on('data', (chunk: Buffer) => {
      comfyLogStream?.write(chunk);
    });
    comfyChild.on('exit', () => {
      comfyChild = null;
      comfyLogStream?.end();
      comfyLogStream = null;
    });
    // Wait until the port answers (ComfyUI first load can take 1-2 min).
    const start = Date.now();
    while (Date.now() - start < 240_000) {
      if (await probe(COMFYUI_PORT, 1500)) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
    }
    throw new Error('ComfyUI 未在 240s 内就绪，请查看日志');
  })().finally(() => {
    comfyStarting = null;
  });
  return comfyStarting;
}

/** Stop ComfyUI by killing the process tree listening on :8188. */
export async function stopComfyUi(): Promise<void> {
  // Kill the tree we spawned first, if any.
  if (comfyChild) {
    try {
      comfyChild.kill();
    } catch {
      // already gone
    }
    comfyChild = null;
  }
  // Also reap any process tree listening on 8188 (e.g. started by the launcher).
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolveStop) => {
    execFile(
      'netstat',
      ['-ano'],
      { windowsHide: true },
      (error, stdout) => {
        if (!error) {
          const lines = String(stdout).split(/\r?\n/);
          const pids = new Set<string>();
          for (const line of lines) {
            if (/:8188\s.*LISTENING/.test(line)) {
              const pid = line.trim().split(/\s+/).pop();
              if (pid && /^\d+$/.test(pid)) pids.add(pid);
            }
          }
          for (const pid of pids) {
            try {
              process.kill(Number(pid));
            } catch {
              // already gone
            }
          }
        }
        resolveStop();
      }
    );
  });
}

export function startLlama(): Promise<void> {
  return ensureLlamaServer();
}

export function stopLlama(): Promise<void> {
  return stopLlamaServer();
}

export function readComfyUiLog(lines = 120): string {
  const logPath = join(logsDir(), 'comfyui.log');
  if (!existsSync(logPath)) return '';
  const text = readFileSync(logPath, 'utf8');
  const all = text.split(/\r?\n/);
  return all.slice(Math.max(0, all.length - lines)).join('\n');
}

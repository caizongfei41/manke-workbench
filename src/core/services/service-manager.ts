import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  baseUrl as resolveLlmBaseUrl,
  ensureLlamaServer,
  isRemoteProvider,
  stopLlamaServer,
} from '@/core/adapters/llm-manager';

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
  // 不要写死任何盘符。
  //
  // 这里原来第一候选是 'E:\ComfyUI' —— 开发机上的路径。拿到别的电脑上，
  // 那台机器如果刚好有个同名空目录，程序会认成 ComfyUI 根，然后所有路径
  // 都指错地方。只从配置文件和相对位置找。
  const candidates = [
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
  // 什么都没找到就返回空串，让调用方判断「还没配置」。
  // 回退到一个写死的盘符是最糟的选择：换台电脑那个路径可能真有东西，
  // 于是程序以为配置好了，实际指向一个不相干的目录。
  return '';
}

export function comfyUiPython(): string {
  const root = comfyUiRoot();
  // python_embeded 可能在 root 下，也可能在 root 的上一层。
  //
  // 部署包解出来的结构是「根目录下并列放 ComfyUI 和 python_embeded」：
  //   D:\某目录\ComfyUI\        ← comfyUiRoot() 返回这里
  //   D:\某目录\python_embeded\
  // 只按 root 拼永远找不到，会掉到下面的配置回退分支 —— 能跑，但控制台
  // 显示的路径和实际不符，用户会以为配错了。
  const candidates = [
    join(root, 'python_embeded', 'python.exe'),
    resolve(root, '..', 'python_embeded', 'python.exe'),
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

/**
 * 改 ComfyUI 根目录并写进配置。
 *
 * 只在目录里真的有 python_embeded\python.exe 时才接受 —— 用户随手点错一个
 * 空文件夹的话，写进去之后服务永远起不来，界面上只会看到「未连接」，比拒绝
 * 保存更难排查。
 */
export function setComfyUiRoot(root: string): { ok: boolean; message?: string } {
  const trimmed = root.trim();
  if (!trimmed) return { ok: false, message: '路径为空' };
  if (!existsSync(trimmed)) return { ok: false, message: `目录不存在：${trimmed}` };

  // ComfyUI 可能在 <root>\ComfyUI\ 下（便携包常见结构），两种都认
  const pyCandidates = [
    join(trimmed, 'python_embeded', 'python.exe'),
    join(trimmed, 'ComfyUI', 'python_embeded', 'python.exe'),
  ];
  const py = pyCandidates.find((p) => existsSync(p));
  if (!py) {
    return { ok: false, message: '这个目录里没有 python_embeded\\python.exe，不是 ComfyUI 根目录' };
  }

  try {
    const dir = dataRoot();
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'comfyui.config.json');
    let existing: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      } catch {
        /* 配置坏了就重写 */
      }
    }
    writeFileSync(
      configPath,
      JSON.stringify({ ...existing, root: trimmed, pythonPath: py }, null, 2),
      'utf8'
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `写配置失败：${e instanceof Error ? e.message : String(e)}` };
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
  llmRemote: boolean;
  llmBaseUrl: string;
}> {
  // The prompt enhancer can be a remote OpenAI-compatible service instead of
  // a local llama.cpp process. Report whichever is configured: probing a local
  // port for a remote endpoint would always show "stopped" and invite the user
  // to start a server that is not supposed to exist.
  const remote = isRemoteProvider();
  const llmBase = resolveLlmBaseUrl();

  const [comfyUp, llamaUp] = await Promise.all([
    probe(COMFYUI_PORT),
    remote ? Promise.resolve(true) : probe(LLAMA_PORT),
  ]);

  const llmEntry = remote
    ? {
        id: 'llama',
        label: 'AI 扩写（在线）',
        port: 0,
        up: true,
        url: llmBase,
        detail: llmBase,
        remote: true,
      }
    : {
        id: 'llama',
        label: 'AI 扩写 (llama.cpp)',
        port: LLAMA_PORT,
        up: llamaUp,
        url: `http://127.0.0.1:${LLAMA_PORT}`,
        detail: '按需启动，空闲自动停止',
        remote: false,
      };
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
      llmEntry,
    ],
    comfyUiRoot: comfyUiRoot(),
    comfyUiPython: comfyUiPython(),
    llamaManaged: !remote,
    llmRemote: remote,
    llmBaseUrl: llmBase,
  };
}

/**
 * 杀掉占着端口、但不是本实例启动的 ComfyUI。
 *
 * 这类进程是上一次运行留下的孤儿：工作台退出时没带走它，stdout 管道已断，
 * 采样器写进度日志会抛 OSError [Errno 22]，所有任务失败。复用它就是把这个
 * 坏状态接着用下去，所以直接杀掉等端口让开。
 */
async function killStaleComfy(): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  const pids = await new Promise<number[]>((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `@(Get-NetTCPConnection -State Listen -LocalPort ${COMFYUI_PORT} -EA SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','`,
      ],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          String(stdout)
            .trim()
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
        );
      }
    );
  });

  if (pids.length === 0) return; // 查不到进程，保守起见不动

  for (const pid of pids) {
    try {
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } catch {
      /* 进程可能刚好自己退了 */
    }
  }

  // 等端口让开
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!(await probe(COMFYUI_PORT, 1200))) return;
    await new Promise((r) => setTimeout(r, 700));
  }
}

/** Start ComfyUI headless: hidden window, logs streamed to data/logs/comfyui.log. */
export function startComfyUi(): Promise<void> {
  if (comfyStarting) return comfyStarting;
  comfyStarting = (async () => {
    // 端口上已经有 ComfyUI 时不等于「能用」。
    //
    // 上一次工作台退出后，它启动的 ComfyUI 可能还活着（这里原本 detached:
    // true，进程会脱离父进程）。那个进程的 stdout 早断了，采样器每写一次
    // 进度日志就抛 OSError [Errno 22]，所有生成任务失败 —— 界面上只有一句
    // "ComfyUI task failed"。
    //
    // 所以先看是不是自己启动的：不是就杀掉重启，让管道重新挂上。
    if (await probe(COMFYUI_PORT)) {
      if (comfyChild && !comfyChild.killed) return; // 自己开的，正常复用
      await killStaleComfy();
    }
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
        // detached 让子进程脱离父进程的进程组 —— 工作台一退出它就成了孤儿，
        // 端口被占着但日志管道已断。这里必须关掉，让 ComfyUI 跟着工作台走。
        detached: false,
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

// 一键拉起本地三件套：浏览器（CDP）→ ComfyUI → 工作台
//
//   node scripts/stack-up.mjs            启动缺少的那些
//   node scripts/stack-up.mjs --restart  全部重启
//
// 全部 detached 启动，父进程退出后仍然活着；日志写到 .verify/*.log。
// 路径可用环境变量覆盖：QUARK_EXE / COMFY_PYTHON / COMFY_SCRIPT。
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LOG_DIR = process.env.VERIFY_OUT ?? join(ROOT, '.verify');
mkdirSync(LOG_DIR, { recursive: true });

const restart = process.argv.includes('--restart');
const APP_PORT = process.env.PORT ?? '3020';
const CDP_PORT = process.env.CDP_PORT ?? '9232';

const QUARK = process.env.QUARK_EXE ?? 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Quark\\quark.exe';
const COMFY_PYTHON = process.env.COMFY_PYTHON ?? 'E:\\ComfyUI\\python_embeded\\python.exe';
const COMFY_SCRIPT = process.env.COMFY_SCRIPT ?? 'E:\\ComfyUI\\ComfyUI\\main.py';

const up = async (url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
};

const launch = (name, exe, args, cwd, extraEnv = {}) => {
  const fd = openSync(join(LOG_DIR, `${name}.log`), 'a');
  const child = spawn(exe, args, {
    cwd,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  child.unref();
  console.log(`  启动 ${name.padEnd(10)} PID ${child.pid}`);
  return child;
};

const waitFor = async (label, url, seconds = 90) => {
  for (let i = 0; i < seconds; i += 1) {
    if (await up(url)) {
      console.log(`  ${label} 就绪`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`  ${label} 未在 ${seconds}s 内就绪`);
  return false;
};

const targets = {
  cdp: `http://127.0.0.1:${CDP_PORT}/json/version`,
  comfyui: 'http://127.0.0.1:8188/queue',
  app: `http://127.0.0.1:${APP_PORT}`,
};

const [cdpUp, comfyUp, appUp] = await Promise.all([
  up(targets.cdp),
  up(targets.comfyui),
  up(targets.app),
]);

if (restart || !cdpUp) {
  launch('quark', QUARK, [`--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*', `http://127.0.0.1:${APP_PORT}/zh`], dirname(QUARK));
}
if (restart || !comfyUp) {
  // --windows-standalone-build turns auto-launch ON (see cli_args.py L291),
  // so every respawn opened another browser tab. --disable-auto-launch is the
  // documented override and must come along with it.
  launch(
    'comfyui',
    COMFY_PYTHON,
    [
      '-s',
      COMFY_SCRIPT,
      '--windows-standalone-build',
      '--disable-auto-launch',
      '--use-sage-attention',
      '--disable-pinned-memory',
    ],
    dirname(COMFY_SCRIPT)
  );
}
if (restart || !appUp) {
  launch('workbench', process.execPath, [join(ROOT, '.output', 'server', 'index.mjs')], ROOT, {
    PORT: APP_PORT,
    BEATDESIGN_GENERATION_PROVIDER: process.env.BEATDESIGN_GENERATION_PROVIDER ?? 'comfyui',
  });
}

const results = await Promise.all([
  cdpUp && !restart ? true : waitFor('cdp     ', targets.cdp, 40),
  comfyUp && !restart ? true : waitFor('comfyui ', targets.comfyui, 150),
  appUp && !restart ? true : waitFor('workspace', targets.app, 90),
]);

if (results.some((ok) => !ok)) {
  console.log('  有服务没起来，看 .verify/*.log');
  process.exit(1);
}
console.log('  三件套就位');

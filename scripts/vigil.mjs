// 本地守护：定期跑 GPU 组套件，把结果写进 .verify/gpu-latest.json
//
//   node scripts/vigil.mjs --once          跑一次就退出（手动验证用）
//   node scripts/vigil.mjs                 常驻，按 --interval 分钟轮询
//   node scripts/vigil.mjs --interval 720  每 12 小时一次（默认）
//
// 设计取向：宁可跳过，也不要和正在渲染的任务抢显卡。ComfyUI 在忙时直接跳过这一轮，
// 并在结果里写明原因 —— 一个安静的跳过比一次互相拖慢的失败有用。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERIFY_DIR = process.env.VERIFY_OUT ?? join(ROOT, '.verify');
const RESULT_FILE = join(VERIFY_DIR, 'gpu-latest.json');
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';

const args = process.argv.slice(2);
const once = args.includes('--once');
const intervalMinutes = Number(
  args.find((arg) => arg.startsWith('--interval='))?.split('=')[1] ?? 720
);

mkdirSync(VERIFY_DIR, { recursive: true });

const reachable = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
};

const queueBusy = async () => {
  try {
    const queue = await fetch(`${COMFY}/queue`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    return (queue?.queue_running?.length ?? 0) + (queue?.queue_pending?.length ?? 0) > 0;
  } catch {
    return null;
  }
};

const record = (payload) => {
  writeFileSync(RESULT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
};

const runSuites = () =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, 'run-verify.mjs'), '--group=gpu'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      out += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('close', (code) => {
      const summary = out.match(/合计:\s*通过\s*(\d+)\s*\/\s*失败\s*(\d+)/);
      resolve({
        code,
        pass: summary ? Number(summary[1]) : 0,
        fail: summary ? Number(summary[2]) : -1,
      });
    });
  });

const tick = async () => {
  const startedAt = new Date().toISOString();

  // 前置：三件套必须都在，否则这一轮没有意义
  const [appUp, comfyUp, cdpUp] = await Promise.all([
    reachable(APP),
    reachable(`${COMFY}/queue`),
    reachable(`${CDP}/json/version`),
  ]);
  if (!appUp || !comfyUp || !cdpUp) {
    const missing = [!appUp && 'app', !comfyUp && 'comfyui', !cdpUp && 'cdp'].filter(Boolean);
    const payload = { startedAt, status: 'skipped', reason: `missing ${missing.join(', ')}` };
    record(payload);
    console.log(`  跳过：缺少 ${missing.join(', ')}`);
    return payload;
  }

  // 别人正在渲染时不要抢卡
  const busy = await queueBusy();
  if (busy) {
    const payload = { startedAt, status: 'skipped', reason: 'comfyui busy' };
    record(payload);
    console.log('  跳过：ComfyUI 正在跑任务');
    return payload;
  }

  console.log(`  开始跑 GPU 组 @ ${startedAt}`);
  const result = await runSuites();
  const payload = {
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.fail === 0 && result.code === 0 ? 'passed' : 'failed',
    pass: result.pass,
    fail: result.fail,
    exitCode: result.code,
  };
  record(payload);
  console.log(`  结果：${payload.status}（通过 ${payload.pass} / 失败 ${payload.fail}）`);
  return payload;
};

if (once) {
  const result = await tick();
  process.exit(result.status === 'passed' || result.status === 'skipped' ? 0 : 1);
}

console.log(`  守护启动：每 ${intervalMinutes} 分钟一轮，结果写入 ${RESULT_FILE}`);
await tick();
setInterval(() => {
  void tick();
}, intervalMinutes * 60 * 1000);

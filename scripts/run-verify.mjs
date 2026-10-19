// 统一入口：串行跑全部 UI 套件，汇总通过/失败
//
//   pnpm verify:all          全部
//   pnpm verify:all drama    只跑名字含 drama 的
//   pnpm verify:all --list   列出套件
//
// 前置：本地工作台在 3020（或 VERIFY_APP），浏览器调试端口在 9232（或 VERIFY_CDP），
// ComfyUI 在 8188（或 VERIFY_COMFY，只有生成类套件需要）。
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(HERE, 'e2e');
const ROOT = join(HERE, '..');
const VERIFY_DIR = process.env.VERIFY_OUT ?? join(ROOT, '.verify');
mkdirSync(VERIFY_DIR, { recursive: true });

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const includeE2e = args.includes('--e2e');
const filter = args.find((arg) => !arg.startsWith('--')) ?? '';
const suites = readdirSync(SUITE_DIR)
  .filter((name) => (includeE2e ? /^(verify|e2e)-.*\.mjs$/.test(name) : name.startsWith('verify-') && name.endsWith('.mjs')))
  .filter((name) => (filter ? name.includes(filter) : true))
  .sort();

if (listOnly) {
  for (const name of suites) console.log(name.replace(/\.mjs$/, ''));
  process.exit(0);
}
if (!suites.length) {
  console.log(`没有匹配「${filter}」的套件`);
  process.exit(1);
}

const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';

// ComfyUI 挂了就自己拉起来：生成类套件全依赖它，静默全红比直接说明更难查
const COMFY_PYTHON = process.env.VERIFY_COMFY_PYTHON ?? 'E:\\ComfyUI\\python_embeded\\python.exe';
const COMFY_SCRIPT = process.env.VERIFY_COMFY_SCRIPT ?? 'E:\\ComfyUI\\ComfyUI\\main.py';

let restarts = 0;

const browserAlive = async () => {
  try {
    const tabs = await fetch(`${CDP}/json`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
    return tabs.some((tab) => tab.type === 'page');
  } catch {
    return false;
  }
};

const comfyAlive = async () => {
  try {
    const res = await fetch(`${COMFY}/queue`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

const ensureComfy = async () => {
  if (await comfyAlive()) return true;
  restarts += 1;
  console.log('  ComfyUI 未响应，尝试拉起…');
  try {
    // detached + unref：父进程退出后它仍然活着
    const logPath = join(VERIFY_DIR, 'comfyui.log');
    const fd = openSync(logPath, 'a');
    const child = spawn(COMFY_PYTHON, ['-s', COMFY_SCRIPT, '--windows-standalone-build', '--use-sage-attention', '--disable-pinned-memory'], {
      cwd: dirname(COMFY_SCRIPT),
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    console.log('  拉起失败: ' + error.message);
    return false;
  }
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (await comfyAlive()) {
      console.log('  ComfyUI 已就绪');
      return true;
    }
  }
  console.log('  ComfyUI 仍未就绪，生成类套件会失败');
  return false;
};
// 套件之间必须清场：上一套的生成任务还在 GPU 上，下一套的队列断言就会假失败
const settle = async () => {
  // 先等队列自己排空：动不动就 interrupt 正在推理的视频任务，比等更伤
  let queue = null;
  for (let i = 0; i < 40; i += 1) {
    queue = await fetch(`${COMFY}/queue`).then((r) => r.json()).catch(() => null);
    const busy = (queue?.queue_running?.length ?? 0) + (queue?.queue_pending?.length ?? 0);
    if (busy === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const stillBusy =
    (queue?.queue_running?.length ?? 0) + (queue?.queue_pending?.length ?? 0);
  if (stillBusy > 0) await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

  // 显存不释放会一路累积：空闲就看到 12G/20G，下一套一开跑就爆，
  // 表现为 ComfyUI 无声消失（没有 Python 栈，是驱动层回收）。
  await fetch(`${COMFY}/free`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {});

  // 关掉多余页面，但一定留一个 3020 页面：套件靠「找现有标签」启动
  const tabs = await fetch(`${CDP}/json`).then((r) => r.json()).catch(() => []);
  const appTabs = tabs.filter((tab) => tab.type === 'page' && /:3020/.test(tab.url ?? ''));
  for (const extra of appTabs.slice(1)) {
    await fetch(`${CDP}/json/close/${extra.id}`).catch(() => {});
  }
  if (!appTabs.length) {
    await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}/zh`, { method: 'PUT' }).catch(() => {});
  }
};
const runOne = (name) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(SUITE_DIR, name)], {
      cwd: ROOT,
      env: { ...process.env, VERIFY_OUT: VERIFY_DIR + (process.platform === 'win32' ? '\\' : '/') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', (code) => {
      // 套件有三种汇总写法：标准「汇总」、端到端结论、单次探测结论
      const summary = out.match(/汇总[:：]\s*通过\s*(\d+)\s*\/\s*失败\s*(\d+)/);
      const e2e = out.match(/端到端结果[:：]\s*(.+)/);
      const probe = out.match(/->\s*(SUCCESS|FAILURE)/);
      // 有的套件不打印汇总，只靠退出码表态；退出码本身就是结论
      const counted = summary
        ? { pass: Number(summary[1]), fail: Number(summary[2]) }
        : e2e
          ? { pass: /生成成功/.test(e2e[1]) ? 1 : 0, fail: /生成成功/.test(e2e[1]) ? 0 : 1 }
          : probe
            ? { pass: probe[1] === 'SUCCESS' ? 1 : 0, fail: probe[1] === 'SUCCESS' ? 0 : 1 }
            : { pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, byExit: true };
      resolve({
        name: name.replace(/\.mjs$/, ''),
        code,
        ...counted,
        tail: out.trim().split('\n').slice(-4).join('\n'),
      });
    });
  });

let totalPass = 0;
let totalFail = 0;
const broken = [];

await ensureComfy();
console.log(`跑 ${suites.length} 套（产物写入 .verify/）` + String.fromCharCode(10));
for (const name of suites) {
  await ensureComfy();
  await settle();
  const restartsBefore = restarts;
  let result = await runOne(name);
  const browserWasLost = !(await browserAlive());
  // 只有「跑这一套期间 ComfyUI 重启过」才重试一次：那是基础设施塌了，不是产品坏了
  if (result.fail > 0 && (restarts > restartsBefore || browserWasLost)) {
    console.log(
      `  ..   ${result.name} 失败时${browserWasLost ? '浏览器丢了页面' : 'ComfyUI 正在重启'}，重试一次`
    );
    await ensureComfy();
    await settle();
    result = await runOne(name);
    result.retried = true;
  }
  await settle();
  totalPass += result.pass;
  if (result.fail < 0) {
    broken.push(result.name);
    console.log(`  ????  ${result.name}  无汇总输出（退出码 ${result.code}）`);
  } else {
    totalFail += result.fail;
    const mark = result.fail === 0 ? 'ok  ' : 'FAIL';
    console.log(`  ${mark}  ${result.name.padEnd(28)} 通过 ${String(result.pass).padStart(3)} / 失败 ${result.fail}`);
    if (result.fail > 0) broken.push(result.name);
  }
}

console.log(`\n  合计: 通过 ${totalPass} / 失败 ${totalFail}（${suites.length} 套）`);
if (broken.length) {
  console.log(`  需要注意: ${broken.join(', ')}`);
  process.exit(1);
}

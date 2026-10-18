// 统一入口：串行跑全部 UI 套件，汇总通过/失败
//
//   pnpm verify:all          全部
//   pnpm verify:all drama    只跑名字含 drama 的
//   pnpm verify:all --list   列出套件
//
// 前置：本地工作台在 3020（或 VERIFY_APP），浏览器调试端口在 9232（或 VERIFY_CDP），
// ComfyUI 在 8188（或 VERIFY_COMFY，只有生成类套件需要）。
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(HERE, 'e2e');
const ROOT = join(HERE, '..');
const VERIFY_DIR = process.env.VERIFY_OUT ?? join(ROOT, '.verify');
mkdirSync(VERIFY_DIR, { recursive: true });

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const filter = args.find((arg) => !arg.startsWith('--')) ?? '';
const suites = readdirSync(SUITE_DIR)
  .filter((name) => name.startsWith('verify-') && name.endsWith('.mjs'))
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
      const summary = out.match(/汇总[:：]\s*通过\s*(\d+)\s*\/\s*失败\s*(\d+)/);
      resolve({
        name: name.replace(/\.mjs$/, ''),
        code,
        pass: summary ? Number(summary[1]) : 0,
        fail: summary ? Number(summary[2]) : -1,
        tail: out.trim().split('\n').slice(-4).join('\n'),
      });
    });
  });

let totalPass = 0;
let totalFail = 0;
const broken = [];

console.log(`跑 ${suites.length} 套（产物写入 .verify/）\n`);
for (const name of suites) {
  const result = await runOne(name);
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

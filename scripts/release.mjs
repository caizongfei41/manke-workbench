// 发版：改版本号 → 校验 → 打包 → 上传 GitHub Releases。
//
// 一条命令搞定，避免每次手动改 package.json、忘打包、忘传 blockmap。
//
// 用法：
//   node scripts/release.mjs patch     // 0.4.0 → 0.4.1（修 bug）
//   node scripts/release.mjs minor     // 0.4.0 → 0.5.0（加功能）
//   node scripts/release.mjs major     // 0.4.0 → 1.0.0
//   node scripts/release.mjs 0.4.7     // 指定版本
//   node scripts/release.mjs patch --dry   // 只看会做什么，不真跑
//
// 需要环境变量 GH_TOKEN（GitHub 个人令牌，带 repo 权限）。
// 没有 token 时只打包，产物留在 dist-desktop 供手动上传。

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PKG = join(ROOT, 'package.json');
const DIST = join(ROOT, 'dist-desktop');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const bump = args.find((a) => !a.startsWith('--')) ?? 'patch';

const run = (cmd, opts = {}) => {
  console.log(`  $ ${cmd}`);
  if (dry) return '';
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true, ...opts });
};

const bumpVersion = (current, kind) => {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

// ── 1. 版本号
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const next = bumpVersion(pkg.version, bump);

console.log('');
console.log('════════════════════════════════════════');
console.log(`  发版  ${pkg.version} → ${next}`);
console.log('════════════════════════════════════════');
console.log('');

if (dry) {
  console.log('  （dry run，不会真的改文件）');
}

if (!dry) {
  pkg.version = next;
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`  ✓ 版本号写入 package.json`);

  // 其余清单里的版本也要跟着走。
  //
  // 项目里有 6 个文件各自记着版本（MCP 插件、WorkBuddy 连接器、marketplace
  // 清单等），测试会断言「所有清单版本一致」。只改 package.json 的话，
  // 打包能过、发版能过，但测试直接红 —— 之前就是这么踩到的。
  const VERSION_FILES = [
    'electron/package.json',
    '.claude-plugin/marketplace.json',
    'integrations/claude-code/beatdesign/.claude-plugin/plugin.json',
    'integrations/codex/beatdesign/.codex-plugin/plugin.json',
    'integrations/workbuddy/beatdesign/connector-meta.json',
    'lhm.plugin.json',
  ];
  let synced = 0;
  for (const rel of VERSION_FILES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, 'utf8');
    // 只替换 version 字段，别碰别的同名字符串
    const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/g, `$1${next}$2`);
    if (updated !== raw) {
      writeFileSync(abs, updated, 'utf8');
      synced += 1;
    }
  }
  console.log(`  ✓ 同步了 ${synced} 个清单文件的版本号`);

  // 安装源里那条程序包标题也带版本
  const SOURCES = join(ROOT, 'data', 'install-sources.json');
  if (existsSync(SOURCES)) {
    const raw = readFileSync(SOURCES, 'utf8');
    const updated = raw.replace(/漫客工作台 \d+\.\d+\.\d+/, `漫客工作台 ${next}`);
    if (updated !== raw) {
      writeFileSync(SOURCES, updated, 'utf8');
      console.log('  ✓ 更新 install-sources.json 的版本号');
    }
  }
}

// ── 2. 前置校验：任何一项不过就不发版
console.log('');
console.log('  校验:');
run('node scripts/check-i18n.mjs');
run('node node_modules/typescript/bin/tsc --noEmit');
run('node scripts/run-tests.mjs');
console.log('  ✓ 校验通过');

// ── 3. 打包
console.log('');
console.log('  打包:');
run('pnpm build');
run('node scripts/make-desktop.mjs --prepare');
run('node scripts/make-electron-app.mjs');

// 上一次的产物留着会混淆，先清掉
if (!dry && existsSync(DIST)) {
  execFileSync('cmd', ['/c', `rmdir /s /q "${DIST}"`], { stdio: 'ignore' });
}

const token = process.env.GH_TOKEN;
const publishFlag = token ? '--publish always' : '--publish never';

if (!token) {
  console.log('');
  console.log('  ⚠ 没有 GH_TOKEN，只打包不发版。');
  console.log('    产物在 dist-desktop/，可手动传到 GitHub Releases。');
}

run(`pnpm exec electron-builder --win --config electron-builder.yml ${publishFlag}`);

// ── 4. 结果
console.log('');
console.log('════════════════════════════════════════');
if (token) {
  console.log(`  ✓ ${next} 已发布到 GitHub Releases`);
  console.log('  ✓ 用户下次启动会自动发现并后台下载');
} else {
  console.log('  产物:');
  try {
    for (const f of readFileSync(join(DIST, 'latest.yml'), 'utf8').split('\n')) {
      if (f.includes('url:') || f.includes('path:')) console.log('    ' + f.trim());
    }
  } catch {
    /* 没打出来就算了 */
  }
  console.log('');
  console.log('  手动发版步骤:');
  console.log('    1. 打开 https://github.com/caizongfei41/manke-workbench/releases/new');
  console.log(`    2. tag 填 v${next}`);
  console.log('    3. 上传 dist-desktop 里的 .exe / .blockmap / latest.yml');
  console.log('    4. 发布');
}
console.log('════════════════════════════════════════');
console.log('');

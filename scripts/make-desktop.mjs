// 把工作台打成单文件桌面程序。
//
//   node scripts/make-desktop.mjs            构建 + 打包（产出 portable exe 和安装器）
//   node scripts/make-desktop.mjs --prepare  只准备 build-resources，不打包
//
// 流程：
//   1. pnpm build                 → .output（服务端 + 静态资源）
//   2. 复制 .output → build-resources
//   3. electron-builder           → 单文件 exe
//
// 单文件（portable）优先：目标用户不想装东西，双击就用。安装器作为备选一起出，
// 因为它能注册开始菜单和卸载项。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, '.output');
const RES = join(ROOT, 'build-resources');
const DIST = join(ROOT, 'dist-desktop');

const args = process.argv.slice(2);
const prepareOnly = args.includes('--prepare');

const human = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const run = (cmd, cmdArgs, label) => {
  console.log(`  ${label} …`);
  try {
    execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: true });
  } catch (error) {
    console.error(`  失败: ${label}`);
    process.exit(1);
  }
};

// ── 1. 构建
if (!prepareOnly) {
  run('pnpm', ['build'], '构建工作台');
}

if (!existsSync(join(OUT, 'server', 'index.mjs'))) {
  console.error('  构建产物缺失：.output/server/index.mjs');
  process.exit(1);
}

// ── 2. 准备 resources
rmSync(RES, { recursive: true, force: true });
mkdirSync(RES, { recursive: true });

for (const name of ['server', 'public']) {
  cpSync(join(OUT, name), join(RES, name), { recursive: true });
}
cpSync(join(OUT, 'nitro.json'), join(RES, 'nitro.json'));

// 工作流模板。
//
// data/comfyui/workflows 下的 22 个 JSON 是工作台的核心资产 —— 创作台列的
// 模板、环境自检核对的依赖清单都从这里读。之前只拷了 server/public，
// 打包后的程序一个模板都没有，环境自检永远显示「工作流模板 0 个」。
const DATA_SRC = join(ROOT, 'data');
if (existsSync(DATA_SRC)) {
  cpSync(DATA_SRC, join(RES, 'data'), { recursive: true });
  const wfDir = join(RES, 'data', 'comfyui', 'workflows');
  const wfCount = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => f.endsWith('.json')).length : 0;
  console.log(`  工作流模板: ${wfCount} 个`);
} else {
  console.log('  工作流模板: 缺少 data 目录');
}

// 部署包清单。
//
// 程序靠它知道有哪 9 个包、各多大、解到哪。清单在 dist-bundles 里生成，
// 上面那句 rmSync(RES) 会连 bundles 一起清掉，所以这里必须重新拷一次 ——
// 漏了的话打包出来的程序找不到清单，引导页的「分模块部署」整块不显示。
const manifestCandidates = [
  join(ROOT, 'dist-bundles', 'manifest.json'),
  join(ROOT, 'build-resources', 'bundles', 'manifest.json'),
];
const manifestSrc = manifestCandidates.find((p) => existsSync(p));
if (manifestSrc) {
  mkdirSync(join(RES, 'bundles'), { recursive: true });
  cpSync(manifestSrc, join(RES, 'bundles', 'manifest.json'));
  const parsed = JSON.parse(readFileSync(manifestSrc, 'utf8'));
  console.log(
    `  部署包清单: ${parsed.parts?.length ?? 0} 个包 / ${((parsed.totalBytes ?? 0) / 1024 ** 3).toFixed(2)} GB`
  );
} else {
  console.log('  部署包清单: 缺失（引导页不会显示分模块部署）');
}

// 运维脚本。
//
// 控制台的「一键部署」和「环境自检」不是纯 JS 实现的，它们 spawn 一个 .mjs
// 去跑（scripts/deploy-bundle.mjs 负责解压、check-environment.mjs 检查节点包
// 和模型）。主进程把 BEATDESIGN_ROOT 指向 resources，所以这两个脚本必须在这。
// 漏打包的话控制台会显示 Missing .../scripts/xxx.mjs，那两块功能全灰。
const SCRIPTS = join(RES, 'scripts');
mkdirSync(SCRIPTS, { recursive: true });
let scriptCount = 0;
for (const name of ['deploy-bundle.mjs', 'check-environment.mjs']) {
  const src = join(ROOT, 'scripts', name);
  if (existsSync(src)) {
    cpSync(src, join(SCRIPTS, name));
    scriptCount += 1;
  } else {
    console.log(`  运维脚本缺失: scripts/${name}`);
  }
}
console.log(`  运维脚本: ${scriptCount} 个`);

// 建表 SQL：桌面程序首次启动时在用户数据目录执行。
//
// drizzle 把迁移放在 drizzle/sqlite/，meta/ 下是 snapshot JSON —— 那些只在
// drizzle-kit 生成下一个迁移时用得到，运行时不需要。这里只搬 .sql，摊平到
// migrations/，db-bootstrap 按文件名排序执行。
const MIGRATIONS = join(RES, 'migrations');
mkdirSync(MIGRATIONS, { recursive: true });
let sqlCount = 0;
const collectSql = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSql(full);
    else if (entry.name.endsWith('.sql')) {
      cpSync(full, join(MIGRATIONS, entry.name));
      sqlCount += 1;
    }
  }
};
collectSql(join(ROOT, 'drizzle'));
if (sqlCount === 0) {
  console.error('  迁移 SQL 缺失：drizzle/ 下没有 .sql');
  process.exit(1);
}
console.log(`  迁移 SQL: ${sqlCount} 个`);

// 内置 7-Zip：解压部署包要用。
//
// 目标机器上不保证装了 7-Zip，而解 211 GB 的分卷又必须有它。旧控制台把
// 7z.exe 和 7z.dll 一起带上了，这里照做 —— 两个文件 2.4 MB，换掉「请先安装
// 7-Zip」这类人肉步骤。
const SEVEN_ZIP_SOURCES = [
  'C:\\Program Files\\7-Zip',
  'C:\\Program Files (x86)\\7-Zip',
];
// 运行 7z.exe 需要这两个；7z.dll 是它压缩/解压格式的引擎
const SEVEN_ZIP_FILES = ['7z.exe', '7z.dll'];

let sevenZipDir = null;
for (const dir of SEVEN_ZIP_SOURCES) {
  if (existsSync(join(dir, '7z.exe')) && existsSync(join(dir, '7z.dll'))) {
    sevenZipDir = dir;
    break;
  }
}

if (sevenZipDir) {
  for (const name of SEVEN_ZIP_FILES) {
    cpSync(join(sevenZipDir, name), join(RES, name));
  }
  const bytes = SEVEN_ZIP_FILES.reduce((sum, n) => sum + statSync(join(RES, n)).size, 0);
  console.log(`  7-Zip: 已内置（${human(bytes)}）`);
} else {
  // 不致命，但部署包解压会退回到找系统 7-Zip
  console.log('  7-Zip: 本机没装，跳过。打包后的程序解压部署包时需要系统有 7-Zip');
}

// 图标：有就用，没有 electron-builder 会用默认图标
const icon = join(ROOT, 'assets', 'branding', 'app-icon.ico');
if (existsSync(icon)) {
  cpSync(icon, join(RES, 'icon.ico'));
  console.log('  图标: 已复制');
} else {
  console.log('  图标: 缺失，将使用默认图标');
}

const size = (dir) => {
  let total = 0;
  const walk = (p) => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += statSync(full).size;
    }
  };
  walk(dir);
  return total;
};

console.log(`  build-resources: ${human(size(RES))}`);

if (prepareOnly) {
  console.log('  完成（只准备，未打包）');
  process.exit(0);
}

// ── 3. 打包
mkdirSync(DIST, { recursive: true });
run(
  'pnpm',
  ['exec', 'electron-builder', '--win', '--config', 'electron-builder.yml'],
  'electron-builder'
);

const files = existsSync(DIST)
  ? require('node:fs')
      .readdirSync(DIST)
      .filter((f) => f.endsWith('.exe') || f.endsWith('.zip'))
  : [];
console.log('');
console.log('  产物:');
for (const f of files) {
  const p = join(DIST, f);
  console.log(`    ${f}  ${human(statSync(p).size)}`);
}

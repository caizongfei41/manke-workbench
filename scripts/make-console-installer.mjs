// 打包控制台安装器
//
//   node scripts/make-console-installer.mjs            检查会打什么
//   node scripts/make-console-installer.mjs --make     生成安装包
//
// 产出 dist/漫客工作台控制台-Setup/：
//   Setup.exe            双击运行的安装器（自解压 + 跑 install.ps1）
//   install.ps1          实际安装逻辑
//   files/               要装的东西
//     ├── launcher/      控制台脚本和图标
//     ├── scripts/       部署与自检脚本
//     ├── docs/          依赖清单
//     └── node/          便携 Node（新机器没装 Node 也能用）
//
// 为什么自带 Node：控制台要跑 deploy-bundle.mjs 和 check-environment.mjs，
// 都依赖 node。要求用户先装 Node 等于把「一键部署」的门槛又抬回去了。
// Node 压缩后约 40 MB，值得。
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, '漫客工作台控制台-Setup');
const FILES = join(STAGE, 'files');

const args = new Set(process.argv.slice(2));

const SEVEN_ZIP = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].find(
  (p) => existsSync(p)
);

const NODE_EXE = process.execPath;
const NODE_DIR = dirname(NODE_EXE);

/** 要装的内容。相对路径 → 目标位置（相对安装根）。 */
const PAYLOAD = [
  { src: join(ROOT, 'launcher'), name: 'launcher', label: '控制台脚本' },
  { src: join(ROOT, 'scripts'), name: 'scripts', label: '部署与自检脚本', exclude: ['shotfilm-'] },
  { src: join(ROOT, 'docs'), name: 'docs', label: '依赖清单', only: ['DEPENDENCIES.md'] },
  // version.json 决定控制台能否判断「本地是新是旧」。打包时漏掉它，
  // 装好的控制台就永远认为自己落后于远程。
  { src: join(ROOT, 'version.json'), name: 'version.json', label: '版本号', file: true },
  // 首页展示素材。工作台源码里本来就有，但用户手上的部署包是旧的 ——
  // 那些包解压出来的 public/showcase 是空的，seeding 会找不到文件，
  // 首页就只剩空状态。控制台自带一份，seeding 发现缺了就补进去。
  { src: join(ROOT, 'public', 'showcase'), name: 'showcase-assets', label: '首页展示素材' },
];

/** 便携 Node：只要 node.exe 和必要的 dll，不要 npm 那一堆。 */
const copyPortableNode = () => {
  const dest = join(FILES, 'node');
  mkdirSync(dest, { recursive: true });
  let bytes = 0;
  for (const entry of readdirSync(NODE_DIR)) {
    // node.exe + 运行必需的 dll/包目录；npm / pnpm / include 都不要
    const keep =
      entry === 'node.exe' ||
      entry.endsWith('.dll') ||
      entry === 'node_modules' ||
      entry === 'corepack';
    if (!keep) continue;
    const from = join(NODE_DIR, entry);
    const to = join(dest, entry);
    cpSync(from, to, { recursive: true, filter: (p) => !p.includes(`${entry}\\npm\\`) });
    const st = statSync(from);
    bytes += st.isDirectory() ? 0 : st.size;
  }
  // 把 7z.exe 和它的 dll 一起带上：install.cmd 和 deploy-bundle 都要解压，
  // 要求用户先装 7-Zip 等于把「一键」的门槛又抬回去。
  if (SEVEN_ZIP) {
    const sevenDir = dirname(SEVEN_ZIP);
    for (const name of readdirSync(sevenDir)) {
      if (name === '7z.exe' || name.endsWith('.dll')) {
        try {
          cpSync(join(sevenDir, name), join(dest, name));
          bytes += statSync(join(sevenDir, name)).size;
        } catch {
          /* 个别 dll 读不到不影响主流程 */
        }
      }
    }
  }
  return bytes;
};

const human = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

const measure = (dir) => {
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      try {
        if (e.isDirectory()) walk(full);
        else total += statSync(full).size;
      } catch {
        /* skip unreadable */
      }
    }
  };
  walk(dir);
  return total;
};

const plan = () => {
  console.log(`  输出目录: ${STAGE}`);
  console.log('');
  console.log('  会打包这些：');
  for (const item of PAYLOAD) {
    if (!existsSync(item.src)) {
      console.log(`   ✗ ${item.label}: 源目录不存在 ${item.src}`);
      continue;
    }
    const size = item.file
      ? statSync(item.src).size
      : item.only
        ? item.only.reduce((sum, name) => {
            const p = join(item.src, name);
            return sum + (existsSync(p) ? statSync(p).size : 0);
          }, 0)
        : measure(item.src);
    console.log(`   ${item.label.padEnd(14)} ${human(size).padStart(8)}`);
  }
  console.log(`   ${'便携 Node'.padEnd(14)} ${'约 40 MB'.padStart(8)}  （${NODE_EXE}）`);
  console.log('');
  console.log('  安装包内置：');
  console.log('   · 双击 Setup.exe 自动解压并安装');
  console.log('   · 自带 Node，目标机器不用装');
  console.log('   · 装完创建桌面快捷方式');
};

const make = () => {
  if (!SEVEN_ZIP) {
    console.error('  找不到 7z.exe，无法制作自解压安装器');
    return 1;
  }

  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(FILES, { recursive: true });

  // 1. 复制负载
  let copied = 0;
  for (const item of PAYLOAD) {
    if (!existsSync(item.src)) {
      console.log(`    ! 跳过（不存在）：${item.label}`);
      continue;
    }
    const dest = join(FILES, item.name);

    // 单文件条目：直接复制到 files/ 根下
    if (item.file) {
      cpSync(item.src, dest);
      copied += 1;
      continue;
    }

    mkdirSync(dest, { recursive: true });

    if (item.only) {
      for (const name of item.only) {
        const from = join(item.src, name);
        if (existsSync(from)) {
          cpSync(from, join(dest, name));
          copied += 1;
        }
      }
      continue;
    }

    for (const entry of readdirSync(item.src)) {
      if (item.exclude?.some((x) => entry.includes(x))) continue;
      const from = join(item.src, entry);
      cpSync(from, join(dest, entry), { recursive: true });
      copied += 1;
    }
  }
  console.log(`  已复制 ${copied} 项负载`);

  // 2. 便携 Node
  const nodeBytes = copyPortableNode();
  console.log(`  便携 Node ${human(nodeBytes)}`);

  // 3. 安装脚本
  const ensureBom = (path) => {
    const buf = readFileSync(path);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return false;
    writeFileSync(path, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), buf]));
    return true;
  };

  // 打包前先查源文件。fixPs1 会在拷贝后补 BOM，所以装出来的能跑 —— 但源文件
  // 缺 BOM 意味着任何人直接用编辑器打开、用 PowerShell 解析都会看到乱码和
  // 语法错误。那种「打包能过、源码是坏的」状态最难查，所以在这里直接点出来。
  const missingBom = [];
  const scanBom = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) scanBom(full);
      else if (e.name.endsWith('.ps1')) {
        const buf = readFileSync(full);
        if (!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)) {
          missingBom.push(relative(ROOT, full));
        }
      }
    }
  };
  scanBom(join(ROOT, 'launcher'));
  if (missingBom.length > 0) {
    console.log('  ! 源文件缺 UTF-8 BOM（打包时会补，但源码本身不干净）：');
    for (const f of missingBom) console.log('      ' + f);
  }

  writeFileSync(join(STAGE, 'install.ps1'), INSTALL_SCRIPT, 'utf8');
  ensureBom(join(STAGE, 'install.ps1'));
  // 负载里的 .ps1 也要有 BOM，否则装到目标机器一样跑不起来
  const fixPs1 = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) fixPs1(full);
      else if (e.name.endsWith('.ps1') && ensureBom(full)) {
        console.log('    补 BOM: ' + full.replace(STAGE, ''));
      }
    }
  };
  fixPs1(FILES);
  copyFileSync(join(ROOT, 'launcher', 'install.cmd'), join(STAGE, '安装.cmd'));

  // 4. 自解压：把 files/ 打成 7z sfx
  const archive = join(STAGE, 'payload.7z');
  execFileSync(SEVEN_ZIP, ['a', '-mx3', '-t7z', archive, 'files', 'install.ps1'], {
    cwd: STAGE,
    stdio: 'inherit',
  });
  console.log(`  归档 ${human(statSync(archive).size)}`);

  // 7z.sfx 只会解压不会执行，做不出真正的安装器。
  // 改成「payload.7z + 安装.cmd」：批处理解压后调 install.ps1，双击就行。
  console.log(`  安装器 ${human(statSync(archive).size + statSync(join(STAGE, '安装.cmd')).size)}（payload.7z + 安装.cmd）`);

  console.log('');
  console.log(`  完成: ${STAGE}`);
  return 0;
};

/** 7z 自解压模块的位置随版本不同，挨个试。 */
const findSfxModule = () => {
  const candidates = [
    join(dirname(SEVEN_ZIP), '7z.sfx'),
    join(dirname(SEVEN_ZIP), '7zCon.sfx'),
    'C:\\Program Files\\7-Zip\\7z.sfx',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
};

const INSTALL_SCRIPT = readFileSync(join(HERE, '..', 'launcher', 'install.ps1'), 'utf8');


if (args.has('--make')) {
  process.exit(make());
}
plan();

// 部署器：解压一次，得到可运行的 ComfyUI + 工作台
//
//   node scripts/deploy-bundle.mjs --inspect              检查部署包状态
//   node scripts/deploy-bundle.mjs --deploy --to "D:\\"   解压到指定位置
//   node scripts/deploy-bundle.mjs --deploy --to "D:\\" --dry-run
//
// 部署包现在是一个多卷档案：
//   manke-bundle.7z.001 … .007   共 211.1 GB
// 解压后得到：
//   <to>/manke/ComfyUI/      可运行的 ComfyUI（自带 Python、模型、节点）
//   <to>/manke/workbench/    工作台源码
//
// 为什么重写成这样：
//   之前按「类别」分四个包（01-models / 02-nodes / 03-app / 04-comfyui），
//   每个包解到不同目录，逻辑复杂而且卷太多。现在所有内容打成一个档案流，
//   解压一次就位，检查也只需要看一组卷是否连续。
//
// 兼容：如果目录里还是旧的四类包，会提示用户改用新包，不再尝试偷偷兼容 ——
// 两套逻辑并存只会让「为什么检测不到」变成更难查的问题。
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONFIG = join(ROOT, 'data/comfyui.config.json');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

/** 部署包内档案的基名。分卷是 manke-bundle.7z.001 … */
const ARCHIVE_BASE = 'manke-bundle';

/** 7-Zip：系统安装的优先，其次安装包自带的 node/7z.exe。 */
const findSevenZip = () => {
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    join(ROOT, 'node', '7z.exe'),
    join(HERE, '..', 'node', '7z.exe'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
};

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

/** 部署包目录：默认工作台根下的 deploy/，可用 --bundle 指定。 */
const bundleDir = () => resolve(valueOf('--bundle') ?? join(ROOT, 'deploy'));

/**
 * 解压目标。
 * 默认放在部署包所在盘的根下，因为解压需要 211 GB，
 * 而工作台安装目录通常在 C 盘，空间不一定够。
 */
const extractTarget = () => {
  const explicit = valueOf('--to');
  if (explicit) return resolve(explicit);
  const dir = bundleDir();
  const driveRoot = /^[A-Za-z]:/.test(dir) ? `${dir.slice(0, 2)}\\` : join(ROOT, '..');
  return resolve(driveRoot);
};

const human = (bytes) => {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

/**
 * 检查分卷集合。
 * 返回卷数量、总大小、编号是否连续、以及缺失的编号。
 */
const inspectVolumes = (dir, base = ARCHIVE_BASE) => {
  let names;
  try {
    names = readdirSync(dir).filter((f) => new RegExp(`^${base}\\.7z\\.\\d+$`).test(f));
  } catch {
    return { volumes: [], count: 0, bytes: 0, complete: false, missing: [], base };
  }
  const numbered = names
    .map((name) => ({ name, n: Number(name.slice(`${base}.7z.`.length)) }))
    .filter((x) => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.n - b.n);

  const have = new Set(numbered.map((x) => x.n));
  const last = numbered.at(-1)?.n ?? 0;
  const missing = [];
  for (let i = 1; i <= last; i += 1) if (!have.has(i)) missing.push(i);

  const bytes = numbered.reduce((sum, x) => {
    try {
      return sum + statSync(join(dir, x.name)).size;
    } catch {
      return sum;
    }
  }, 0);

  return {
    base,
    volumes: numbered.map((x) => x.name),
    count: numbered.length,
    bytes,
    // 编号连续且至少一卷，才算整套齐了
    complete: numbered.length > 0 && missing.length === 0,
    missing,
  };
};

/** 目录里是否有旧格式的分卷（提示用户换包用）。 */
const detectLegacyBundles = (dir) => {
  const legacyIds = ['01-models', '02-nodes', '03-app', '04-comfyui'];
  try {
    const files = readdirSync(dir);
    return legacyIds.filter((id) => files.some((f) => f.startsWith(`${id}.7z.`)));
  } catch {
    return [];
  }
};

/** 目标盘的剩余空间。 */
const freeSpaceAt = (path) => {
  try {
    const drive = /^[A-Za-z]:/.exec(path)?.[0];
    if (!drive) return null;
    // Windows 下用 fsutil 或 wmic 都慢；这里用 PowerShell 一次调用
    const out = execSync(
      `powershell -NoProfile -Command "(Get-PSDrive ${drive[0]}).Free"`,
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

const inspect = () => {
  const dir = bundleDir();
  const volumes = inspectVolumes(dir);
  const legacy = detectLegacyBundles(dir);
  const target = extractTarget();
  const sevenZip = findSevenZip();
  const free = freeSpaceAt(target);

  return {
    bundleDir: dir,
    archiveBase: ARCHIVE_BASE,
    target,
    sevenZip,
    freeBytes: free,
    volumes,
    legacyBundles: legacy,
    // 解压后大约占多少：档案 211.1 GB 解开后 211 GB，按卷大小估
    estimatedExtractBytes: volumes.bytes,
  };
};

const printInspect = (r) => {
  console.log(`  部署包目录: ${r.bundleDir}`);
  console.log(`  解压到:     ${r.target}`);
  console.log(`  7-Zip:      ${r.sevenZip ?? '未找到'}`);
  console.log('');

  if (r.volumes.count === 0) {
    console.log(`  ✗ 没找到 ${r.archiveBase}.7z.001`);
    if (r.legacyBundles.length > 0) {
      console.log('');
      console.log(`  ⚠ 目录里有旧格式的包：${r.legacyBundles.join('、')}`);
      console.log('    旧包已不再支持。请改用新的一键部署包（manke-bundle.7z.001 …）。');
    }
    return;
  }

  const state = r.volumes.complete ? '完整' : `缺第 ${r.volumes.missing.join(', ')} 卷`;
  console.log(`  分卷: ${r.volumes.count} 个 · ${human(r.volumes.bytes)} · ${state}`);
  console.log('');

  if (r.freeBytes !== null) {
    const need = r.estimatedExtractBytes;
    const enough = r.freeBytes > need * 1.05;
    console.log(
      `  目标盘剩余 ${human(r.freeBytes)}，解压约需 ${human(need)} ${enough ? '✓' : '✗ 不够'}`
    );
    console.log('');
  }

  const blockers = [];
  if (!r.sevenZip) blockers.push('找不到 7z.exe（装 7-Zip，或用自带 node/7z.exe）');
  if (!r.volumes.complete) blockers.push(`分卷不全：${state}`);
  if (r.freeBytes !== null && r.freeBytes <= r.estimatedExtractBytes * 1.05) {
    blockers.push('目标盘空间不足');
  }

  if (blockers.length === 0) {
    console.log('  可以部署：node scripts/deploy-bundle.mjs --deploy');
  } else {
    console.log('  还不能部署：');
    for (const b of blockers) console.log(`     · ${b}`);
  }
};

// ── 进度文件：解压要 20-40 分钟，HTTP 请求扛不住，前端轮询这个
const PROGRESS_FILE = join(ROOT, '.verify', 'deploy-progress.json');

const writeProgress = (patch) => {
  try {
    mkdirSync(dirname(PROGRESS_FILE), { recursive: true });
    const prev = existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) : {};
    writeFileSync(
      PROGRESS_FILE,
      JSON.stringify(
        {
          running: true,
          stage: 'starting',
          detail: '',
          percent: 0,
          startedAt: null,
          finishedAt: null,
          error: null,
          ...prev,
          ...patch,
          finishedAt: patch.running === false ? new Date().toISOString() : null,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // 进度写不进去不影响部署本身
  }
};

const deploy = ({ dryRun }) => {
  const r = inspect();

  if (!r.sevenZip) {
    const msg = '找不到 7z.exe';
    console.error('  ' + msg);
    writeProgress({ running: false, stage: 'failed', detail: msg, error: msg });
    return 1;
  }
  if (!r.volumes.complete) {
    const msg = r.volumes.count === 0 ? `没找到 ${ARCHIVE_BASE}.7z.001` : `分卷不全，缺第 ${r.volumes.missing.join(', ')} 卷`;
    console.error('  ' + msg);
    writeProgress({ running: false, stage: 'failed', detail: msg, error: msg });
    return 1;
  }

  const first = join(r.bundleDir, r.volumes.volumes[0]);
  console.log(`  从 ${r.volumes.volumes[0]} 开始解压 ${r.volumes.count} 个分卷`);
  console.log(`  解压到 ${r.target}`);
  console.log('');

  if (dryRun) {
    console.log('  [dry-run] 跳过实际解压');
    return 0;
  }

  writeProgress({
    running: true,
    stage: 'extracting',
    detail: `解压 ${r.volumes.count} 个分卷（${human(r.volumes.bytes)}）`,
    percent: 5,
  });

  mkdirSync(r.target, { recursive: true });

  try {
    // -y 覆盖不询问；只解第一卷，7-Zip 自动接续 001→002→…
    const out = execFileSync(r.sevenZip, ['x', '-y', `-o${r.target}`, first], {
      cwd: r.target,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const tail = out.trim().split('\n').slice(-3).join(' ').trim();
    console.log(`  ${tail}`);
  } catch (error) {
    const msg = String(error.stdout ?? error).slice(0, 400);
    console.error('  解压失败: ' + msg);
    writeProgress({ running: false, stage: 'failed', detail: '解压失败', percent: 5, error: msg });
    return 1;
  }

  // 解压完检查产出
  const comfyPath = join(r.target, 'manke', 'ComfyUI');
  const workbenchPath = join(r.target, 'manke', 'workbench');
  const hasComfy = existsSync(join(comfyPath, 'main.py'));
  const hasWorkbench = existsSync(join(workbenchPath, 'package.json'));

  console.log('');
  if (hasComfy) console.log(`  ✓ ComfyUI    ${comfyPath}`);
  else console.log(`  ✗ 未找到 ${comfyPath}\\main.py`);
  if (hasWorkbench) console.log(`  ✓ 工作台     ${workbenchPath}`);
  else console.log(`  ✗ 未找到 ${workbenchPath}\\package.json`);

  writeProgress({
    running: false,
    stage: 'done',
    detail: hasComfy && hasWorkbench ? '解压完成' : '解压完成但内容不完整',
    percent: 100,
    error: hasComfy && hasWorkbench ? null : '解压后未找到预期的 ComfyUI 或工作台目录',
  });

  console.log('');
  console.log('  下一步：');
  console.log(`     cd ${workbenchPath}`);
  console.log('     pnpm install');
  console.log('     pnpm build');
  console.log('     pnpm start');
  return hasComfy && hasWorkbench ? 0 : 1;
};

const main = () => {
  // --json 给 API 用
  if (has('--json')) {
    console.log(JSON.stringify(inspect(), null, 2));
    return 0;
  }
  if (has('--deploy')) {
    return deploy({ dryRun: has('--dry-run') });
  }
  printInspect(inspect());
  return 0;
};

process.exit(main());

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

/**
 * 新版方案：9 个独立包，靠 manifest.json 认。
 *
 * 和旧分卷的区别是本质的 —— 分卷是一个档案切开，缺一卷就全废；这里是 9 个
 * 互不依赖的压缩包，缺哪个只影响哪块功能。所以判定逻辑也不同：列出哪些包
 * 在、哪些缺，而不是算编号连不连续。
 */
const inspectModules = (dir) => {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(manifest?.parts) || manifest.parts.length === 0) return null;

  let names;
  try {
    names = new Set(readdirSync(dir));
  } catch {
    names = new Set();
  }

  const present = [];
  const missing = [];
  let bytes = 0;

  for (const part of [...manifest.parts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (names.has(part.file)) {
      let size = part.bytes ?? 0;
      try {
        size = statSync(join(dir, part.file)).size;
      } catch {
        /* 用 manifest 记录的大小 */
      }
      bytes += size;
      present.push({ id: part.id, file: part.file, bytes: size, order: part.order, name: part.name });
    } else {
      missing.push({ id: part.id, file: part.file, bytes: part.bytes ?? 0, order: part.order, name: part.name });
    }
  }

  return {
    kind: 'modules',
    manifest,
    present,
    missing,
    count: present.length,
    total: manifest.parts.length,
    bytes,
    totalBytes: manifest.totalBytes ?? 0,
    complete: missing.length === 0,
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
  const modules = inspectModules(dir);
  const legacy = detectLegacyBundles(dir);
  const target = extractTarget();
  const sevenZip = findSevenZip();
  const free = freeSpaceAt(target);

  // 新版 9 包方案优先。
  //
  // 界面上那块「部署包状态」是按 volumes 的形状画的（count / bytes /
  // complete / missing），为了不再改一遍前端，这里把 modules 的结果映射成
  // 同样的形状。missing 用文件路径填，提示文字能直接显示缺哪个包。
  const volumes = modules
    ? {
        base: 'manifest',
        volumes: modules.present.map((p) => p.file),
        count: modules.present.length,
        bytes: modules.bytes,
        complete: modules.complete,
        missing: modules.missing.map((m) => m.file),
      }
    : inspectVolumes(dir);

  return {
    bundleDir: dir,
    archiveBase: modules ? 'manifest' : ARCHIVE_BASE,
    target,
    sevenZip,
    freeBytes: free,
    volumes,
    // 新版 9 包方案。null 表示这个目录里没有 manifest.json，走旧分卷逻辑。
    modules,
    legacyBundles: legacy,
    // 解压后大约占多少：解压后和压缩包差不多大（模型已经是压缩过的二进制）
    estimatedExtractBytes: volumes.bytes,
  };
};

const printInspect = (r) => {
  console.log(`  部署包目录: ${r.bundleDir}`);
  console.log(`  解压到:     ${r.target}`);
  console.log(`  7-Zip:      ${r.sevenZip ?? '未找到'}`);
  console.log('');

  // 新版 9 包方案：逐个列出在不在，缺哪个说得清楚
  if (r.modules) {
    const m = r.modules;
    console.log(`  独立包: ${m.count} / ${m.total} 个 · ${human(m.bytes)} / ${human(m.totalBytes)}`);
    console.log('');
    for (const p of m.present) {
      console.log(`  ✓ ${String(p.order).padStart(2)}. ${p.file.padEnd(24)} ${human(p.bytes).padStart(9)}  ${p.name ?? ''}`);
    }
    for (const p of m.missing) {
      console.log(`  ✗ ${String(p.order).padStart(2)}. ${p.file.padEnd(24)} ${human(p.bytes).padStart(9)}  ${p.name ?? ''}`);
    }
    console.log('');
    if (r.freeBytes !== null) {
      const need = r.estimatedExtractBytes;
      const enough = r.freeBytes > need * 1.05;
      console.log(`  目标盘剩余 ${human(r.freeBytes)}，已下的包解压约需 ${human(need)} ${enough ? '✓' : '✗ 不够'}`);
      console.log('');
    }
    if (m.complete) {
      console.log('  可以部署：node scripts/deploy-bundle.mjs --deploy');
    } else {
      console.log(`  还缺 ${m.missing.length} 个包，补齐后可以部署`);
    }
    return;
  }

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

  // ── 新版：9 个独立包，逐个解
  //
  // 每解完一个就把进度记下来，并提示可以删掉那个 .7z —— 这样磁盘峰值只有
  // 最大那个包的大小，而不是全部。中断了下次从缺的那个接着来。
  if (r.modules) {
    const { present, missing, total } = r.modules;
    if (present.length === 0) {
      const msg = '目录里一个包都没有';
      console.error('  ' + msg);
      writeProgress({ running: false, stage: 'failed', detail: msg, error: msg });
      return 1;
    }

    console.log(`  按顺序解压 ${present.length} 个包到 ${r.target}`);
    if (missing.length) {
      console.log(`  还缺 ${missing.length} 个（${missing.map((m) => m.file).join('、')}），先解已有的`);
    }
    console.log('');

    if (dryRun) {
      for (const p of present) console.log(`  [dry-run] 会解 ${p.file}`);
      return 0;
    }

    mkdirSync(r.target, { recursive: true });
    let done = 0;

    for (const p of present) {
      const archive = join(r.bundleDir, p.file);
      const pct = Math.round((done / present.length) * 100);
      writeProgress({
        running: true,
        stage: 'extracting',
        detail: `正在解 ${p.file}（${done + 1}/${present.length}）`,
        percent: pct,
      });
      console.log(`  [${done + 1}/${present.length}] ${p.file}  ${human(p.bytes)}`);

      try {
        execFileSync(r.sevenZip, ['x', '-y', `-o${r.target}`, archive], {
          cwd: r.target,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch (error) {
        const msg = String(error.stdout ?? error).slice(0, 400);
        console.error(`  解压 ${p.file} 失败: ${msg}`);
        writeProgress({ running: false, stage: 'failed', detail: `${p.file} 解压失败`, error: msg });
        return 1;
      }

      done += 1;
      console.log(`        解完，磁盘上这个包可以删了：${p.file}`);
    }

    writeProgress({
      running: false,
      stage: 'done',
      detail: `已解压 ${done} 个包`,
      percent: 100,
    });
    console.log('');
    console.log(`  完成 ${done} 个包 → ${r.target}`);
    if (missing.length) {
      console.log(`  还缺 ${missing.length} 个包没下，补齐后可以再跑一次`);
    }
    return 0;
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

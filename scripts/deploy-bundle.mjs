// 一键部署 · 部署端
//
//   node scripts/deploy-bundle.mjs --inspect          检查部署包是否齐全、能不能装
//   node scripts/deploy-bundle.mjs --deploy           解压并铺好
//   node scripts/deploy-bundle.mjs --deploy --dry-run 只打印会做什么，不动文件
//
// 设计目标：新机器上一个命令从零装好。
//
// 部署包是三类分卷：
//   01-models.7z.00N   模型       → 解到 <ComfyUI>/ComfyUI/
//   02-nodes.7z.00N    节点包     → 解到 <ComfyUI>/ComfyUI/custom_nodes/
//   03-app.7z.00N      工作台源码 → 解到工作台根目录
//
// 判断 ComfyUI 位置：跟 check-environment 一致，环境变量优先，其次从
// data/comfyui.config.json 的 pythonPath 反推。找不到就让用户指定。
import { execFileSync } from 'node:child_process';
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

const SEVEN_ZIP = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  join(ROOT, 'tools', '7z.exe'),
].find((p) => existsSync(p));

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

/**
 * ComfyUI 装在哪 / 装到哪。
 *
 * 三种情况：
 *   1. --comfy 显式指定 → 用它（新机器上是「将要装到这里」）
 *   2. 环境变量 → 用它
 *   3. 从现有配置的 pythonPath 反推 → 已有安装
 * 都没有时返回 null，由调用方决定怎么提示。注意：带 04-comfyui 包时，
 * 这个目录会被创建出来，不需要事先存在。
 */
const resolveComfyRoot = () => {
  const fromArg = valueOf('--comfy');
  if (fromArg) return fromArg;
  if (process.env.BEATDESIGN_COMFYUI_HOME) return process.env.BEATDESIGN_COMFYUI_HOME;
  const cfg = readJson(CONFIG, {});
  const py = String(cfg.pythonPath ?? '');
  const idx = py.toLowerCase().indexOf('python_embeded');
  if (idx > 0) return py.slice(0, idx).replace(/[\\/]+$/, '');
  return null;
};

/** 部署包目录：默认工作台根下的 deploy/，可以用 --bundle 指定。 */
const bundleDir = () => valueOf('--bundle') ?? join(ROOT, 'deploy');

/**
 * 进度文件。
 *
 * 解压 197 GB 要 40 分钟以上，HTTP 请求扛不住。所以 POST 只负责启进程，
 * 前端轮询这个 JSON 看进展。/api/app/deploy 读的是同一个文件。
 */
const PROGRESS_FILE = join(ROOT, '.verify', 'deploy-progress.json');

const writeProgress = (patch) => {
  try {
    mkdirSync(dirname(PROGRESS_FILE), { recursive: true });
    const prev = existsSync(PROGRESS_FILE)
      ? JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))
      : {};
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
    // 进度写不进去不该影响部署本身
  }
};

const BUNDLES = [
  {
    id: '04-comfyui',
    label: '便携 ComfyUI',
    // 包内是 python_embeded/ 和 ComfyUI/，解到 ComfyUI 根（python_embeded 的上一层）
    target: (comfyRoot) => comfyRoot,
    required: true,
    // 必须先于模型和节点：那些要解到 ComfyUI/ 里去，目录得先存在
    order: 0,
  },
  {
    id: '01-models',
    label: '模型',
    // 包内路径就是 models/…，所以解到 COMFY_DIR —— 那层下面直接是 models/
    target: (comfyRoot) => join(comfyRoot, 'ComfyUI'),
    required: true,
    order: 1,
  },
  {
    id: '02-nodes',
    label: '自定义节点包',
    // 包内路径是 custom_nodes/ComfyUI-xxx/…，同样解到 COMFY_DIR
    target: (comfyRoot) => join(comfyRoot, 'ComfyUI'),
    required: true,
    order: 2,
  },
  {
    id: '03-app',
    label: '工作台源码',
    target: () => ROOT,
    required: false,
    order: 3,
  },
];

const human = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

/** 列出一个包的所有分卷，并检查编号是否连续。 */
const inspectVolumeSet = (dir, id) => {
  let names;
  try {
    names = readdirSync(dir).filter((f) => f.startsWith(`${id}.7z.`));
  } catch {
    return { volumes: [], count: 0, bytes: 0, complete: false, missing: [] };
  }
  const numbered = names
    .map((name) => ({ name, n: Number(name.slice(`${id}.7z.`.length)) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);

  const have = new Set(numbered.map((x) => x.n));
  const missing = [];
  for (let i = 1; i <= (numbered.at(-1)?.n ?? 0); i += 1) {
    if (!have.has(i)) missing.push(i);
  }
  const bytes = numbered.reduce((sum, x) => sum + statSync(join(dir, x.name)).size, 0);

  return {
    volumes: numbered.map((x) => x.name),
    count: numbered.length,
    bytes,
    // 编号连续且至少有一卷，才算整套齐了
    complete: numbered.length > 0 && missing.length === 0,
    missing,
  };
};

const inspect = () => {
  const dir = bundleDir();
  const comfyRoot = resolveComfyRoot();
  const report = { bundleDir: dir, comfyRoot, sevenZip: SEVEN_ZIP ?? null, bundles: [] };

  for (const spec of BUNDLES) {
    const info = inspectVolumeSet(dir, spec.id);
    report.bundles.push({
      id: spec.id,
      label: spec.label,
      ...info,
      required: spec.required,
      order: spec.order ?? 9,
      target: comfyRoot ? spec.target(comfyRoot) : null,
    });
  }
  return report;
};

const printInspect = (report) => {
  console.log(`  部署包目录: ${report.bundleDir}`);
  console.log(`  ComfyUI:    ${report.comfyRoot ?? '（未确定，用 --comfy 指定）'}`);
  console.log(`  7-Zip:      ${report.sevenZip ?? '未找到（必需）'}`);
  console.log('');
  for (const b of report.bundles) {
    if (b.count === 0) {
      console.log(`   ${b.id.padEnd(12)} ${b.label.padEnd(10)} 缺失${b.required ? '（必需）' : '（可选）'}`);
      continue;
    }
    const state = b.complete ? '完整' : `缺第 ${b.missing.join(',')} 卷`;
    console.log(
      `   ${b.id.padEnd(12)} ${b.label.padEnd(10)} ${String(b.count).padStart(4)} 卷  ${human(b.bytes).padStart(9)}  ${state}`
    );
    if (b.target) console.log(`   ${' '.repeat(12)} 解压到 ${b.target}`);
  }
  console.log('');

  const blockers = [];
  if (!report.sevenZip) blockers.push('找不到 7z.exe');
  // 带了便携 ComfyUI 就不用事先装；没带才必须指向已有的安装
  const hasPortable = report.bundles.some((b) => b.id === '04-comfyui' && b.count > 0 && b.complete);
  if (!report.comfyRoot) {
    blockers.push(
      hasPortable ? '未指定安装位置（--comfy "D:\\ComfyUI"）' : '未确定 ComfyUI 位置（--comfy 指定）'
    );
  }
  for (const b of report.bundles) {
    if (b.required && b.count === 0) blockers.push(`${b.label} 缺失`);
    else if (b.count > 0 && !b.complete) blockers.push(`${b.label} 分卷不全`);
  }

  if (blockers.length === 0) {
    console.log('  可以部署：node scripts/deploy-bundle.mjs --deploy');
  } else {
    console.log('  还不能部署：');
    for (const b of blockers) console.log(`     · ${b}`);
  }
};

const deploy = ({ dryRun }) => {
  const report = inspect();
  if (!report.sevenZip) {
    console.error('  找不到 7z.exe。装 7-Zip，或把 7z.exe 放到 tools/ 下。');
    writeProgress({ running: false, stage: 'failed', detail: '缺少 7z.exe', percent: 0, error: '7z missing' });
    return 1;
  }
  if (!report.comfyRoot) {
    console.error('  未确定 ComfyUI 位置。用 --comfy "D:\\ComfyUI" 指定。');
    writeProgress({ running: false, stage: 'failed', detail: '未指定安装位置', percent: 0, error: 'comfy root missing' });
    return 1;
  }

  const runnable = report.bundles.filter((b) => b.count > 0 && b.complete);
  if (runnable.length === 0) {
    console.error('  没有可解压的包。');
    writeProgress({ running: false, stage: 'failed', detail: '没有可解压的包', percent: 0, error: 'no bundle' });
    return 1;
  }

  // 顺序要紧：先装便携 ComfyUI，模型和节点才有地方落。
  const ordered = [...runnable].sort((a, b) => (a.order ?? 9) - (b.order ?? 9));
  const totalBytes = ordered.reduce((sum, b) => sum + b.bytes, 0);
  let doneBytes = 0;

  for (const b of ordered) {
    const first = join(report.bundleDir, b.volumes[0]);
    // 包内路径都带了各自的第一层（models/、custom_nodes/、python_embeded/、src/），
    // 所以直接解到 target 就行，不要再往上退一层。
    const cwd = b.target;

    // 前端每 2 秒轮询一次这个文件，所以每开始一个包就写一次
    writeProgress({
      running: true,
      stage: b.id,
      detail: `正在解压${b.label}（${b.count} 卷，${human(b.bytes)}）`,
      percent: Math.round((doneBytes / totalBytes) * 100),
    });

    console.log('');
    console.log(`  ── ${b.label}（${b.count} 卷，${human(b.bytes)}）`);
    console.log(`     解压到 ${cwd}`);

    if (dryRun) {
      console.log('     [dry-run] 跳过实际解压');
      continue;
    }

    mkdirSync(cwd, { recursive: true });
    try {
      // -y 覆盖不询问；只解第一卷，7z 会自动接续 002、003…
      const out = execFileSync(report.sevenZip, ['x', '-y', '-o' + cwd, first], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      const tail = out.trim().split('\n').slice(-2).join(' ').trim();
      console.log(`     ${tail}`);
    } catch (error) {
      console.error(`     解压失败: ${String(error.stdout ?? error).slice(0, 300)}`);
      writeProgress({
        running: false,
        stage: 'failed',
        detail: `${b.label} 解压失败`,
        percent: Math.round((doneBytes / totalBytes) * 100),
        error: String(error.stdout ?? error).slice(0, 300),
      });
      return 1;
    }

    doneBytes += b.bytes;
    writeProgress({
      running: true,
      stage: b.id,
      detail: `${b.label} 完成`,
      percent: Math.round((doneBytes / totalBytes) * 100),
    });
  }

  console.log('');
  console.log('  全部解压完成。下一步：');
  console.log('     pnpm install        # 装 Node 依赖');
  console.log('     pnpm db:push        # 初始化本地数据库');
  console.log('     pnpm build          # 构建产物');
  console.log('     node scripts/check-environment.mjs   # 核对');
  writeProgress({ running: false, stage: 'done', detail: '解压完成', percent: 100 });
  return 0;
};

const main = () => {
  const report = inspect();
  if (has('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  if (has('--deploy')) {
    return deploy({ dryRun: has('--dry-run') });
  }
  printInspect(report);
  return 0;
};

process.exit(main());

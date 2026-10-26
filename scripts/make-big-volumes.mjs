// 打大包：把部署内容切成 5-6 个大包，而不是 119 个碎卷
//
//   node scripts/make-big-volumes.mjs --plan     看会切几包
//   node scripts/make-big-volumes.mjs --make     开始打包
//
// 为什么重做打包：
//   take-deploy-bundle.mjs 按 1.76 GB 切，因为当时以为夸克单文件上限是 1.9 GB。
//   实际 SVIP 能传 100 GB，119 个碎卷让用户要下 119 次、校验 119 次，
//   而且断一个就前功尽弃。
//
// 这里改成：按 34 GB 切，总共 6-7 个包。
//
// 怎么拼出正确的目录结构：
//   7z 打包时只能用「同一个 cwd 下的相对路径」。我们的内容分散在
//     E:\ComfyUI\python_embeded
//     E:\ComfyUI\ComfyUI
//     C:\...\ComfyUI无线画布
//   三个不同的盘符下，没法用一个 cwd 覆盖。
//   所以先建一个暂存目录，用**硬链接**把文件链过去（不占空间），
//   然后从暂存目录的父级打包。
//
// 暂存结构（用户解压后看到的就是这个）：
//   manke/
//     ComfyUI/            ← 直接可以运行的 ComfyUI
//       python_embeded/
//       models/
//       custom_nodes/
//       main.py …
//     workbench/          ← 工作台源码
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MANIFEST = join(ROOT, 'docs/DEPENDENCIES.json');
const SOURCES = join(ROOT, 'data/install-sources.json');
const CONFIG = join(ROOT, 'data/comfyui.config.json');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

const SEVEN_ZIP = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].find(
  (p) => existsSync(p)
);

const VOLUME = process.env.MANKE_VOLUME ?? '34g';
const OUT = process.env.MANKE_OUT ?? 'G:\\manke-big';
/** 暂存目录必须和源在同一分区才能硬链接。默认放 ComfyUI 所在的盘。 */
const STAGE_BASE = process.env.MANKE_STAGE ?? 'E:\\_manke-stage';
const STAGE = join(STAGE_BASE, 'manke');

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const resolveComfyRoot = () => {
  if (process.env.BEATDESIGN_COMFYUI_HOME) return process.env.BEATDESIGN_COMFYUI_HOME;
  const cfg = readJson(CONFIG, {});
  const py = String(cfg.pythonPath ?? '');
  const idx = py.toLowerCase().indexOf('python_embeded');
  if (idx > 0) return py.slice(0, idx).replace(/[\\/]+$/, '');
  return 'E:\\ComfyUI';
};
const COMFY_ROOT = resolveComfyRoot();
const COMFY_DIR = join(COMFY_ROOT, 'ComfyUI');

const manifest = readJson(MANIFEST, { files: [] });
const sources = readJson(SOURCES, { nodes: {} });

const human = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

const measure = (p) => {
  try {
    if (!statSync(p).isDirectory()) return statSync(p).size;
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (['__pycache__', '.git'].includes(e.name)) continue;
    total += measure(join(p, e.name));
  }
  return total;
};

/** 只要工作流引用的模型 + 5 个备选。 */
const collectModels = () => {
  const needed = new Set(
    (manifest.files ?? []).map((f) => String(f.basename).split(/[\\/]/).pop())
  );
  const RESERVE = new Set([
    'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors',
    'minimax_h3_video_vae_int8_convrot.safetensors',
    'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'qwen3vl_8b_int8_convrot.safetensors',
  ]);
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (needed.has(e.name) || RESERVE.has(e.name)) out.push(full);
    }
  };
  walk(join(COMFY_DIR, 'models'));
  return out;
};

const collectNodes = () =>
  Object.keys(sources.nodes ?? {})
    .map((n) => join(COMFY_DIR, 'custom_nodes', n))
    .filter((p) => existsSync(p));

/** 工作台源码：只带必要目录。 */
const WORKBENCH_ITEMS = [
  'src', 'scripts', 'messages', 'public', 'docs', 'launcher', 'drizzle',
  'data/comfyui', 'data/comfyui.config.json',
  'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts',
  'drizzle.config.ts', 'README.md', 'AGENTS.md', 'CHANGELOG.md', '.gitignore',
];

/** 把 src 链到 dst。同分区硬链接，跨分区退化成复制。 */
const linkDir = (src, dst, skip = new Set()) => {
  let linked = 0;
  let copied = 0;
  const walk = (s, d) => {
    const st = statSync(s);
    if (st.isDirectory()) {
      mkdirSync(d, { recursive: true });
      for (const e of readdirSync(s, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        walk(join(s, e.name), join(d, e.name));
      }
      return;
    }
    try {
      linkSync(s, d);
      linked += 1;
    } catch {
      // 跨分区或目标已存在：退回复制
      try {
        mkdirSync(dirname(d), { recursive: true });
        writeFileSync(d, readFileSync(s));
        copied += 1;
      } catch {
        /* 单个文件失败不影响整体 */
      }
    }
  };
  walk(src, dst);
  return { linked, copied };
};

const buildPlan = () => {
  const models = collectModels();
  const nodes = collectNodes();
  const pyBytes = existsSync(join(COMFY_ROOT, 'python_embeded'))
    ? measure(join(COMFY_ROOT, 'python_embeded'))
    : 0;
  const coreBytes = (() => {
    const ex = new Set(['models', 'output', 'custom_nodes', 'input', 'temp', 'user', 'logs', '__pycache__']);
    const walk = (d) => {
      let total = 0;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (ex.has(e.name)) continue;
        const full = join(d, e.name);
        total += e.isDirectory() ? walk(full) : statSync(full).size;
      }
      return total;
    };
    return existsSync(COMFY_DIR) ? walk(COMFY_DIR) : 0;
  })();
  const modelBytes = models.reduce((s, f) => s + statSync(f).size, 0);
  const nodeBytes = nodes.reduce((s, d) => s + measure(d), 0);
  const wbBytes = WORKBENCH_ITEMS.reduce((s, p) => {
    const full = join(ROOT, p);
    return s + (existsSync(full) ? measure(full) : 0);
  }, 0);

  const total = pyBytes + coreBytes + modelBytes + nodeBytes + wbBytes;
  return { models, nodes, pyBytes, coreBytes, modelBytes, nodeBytes, wbBytes, total };
};

const plan = () => {
  const p = buildPlan();
  console.log(`  ComfyUI 根: ${COMFY_ROOT}`);
  console.log(`  暂存目录:  ${STAGE}`);
  console.log(`  输出目录:  ${OUT}`);
  console.log(`  每卷大小:  ${VOLUME}`);
  console.log('');
  console.log('  内容:');
  console.log(`   便携 ComfyUI（Python）  ${human(p.pyBytes).padStart(9)}`);
  console.log(`   ComfyUI 本体            ${human(p.coreBytes).padStart(9)}`);
  console.log(`   模型 ${String(p.models.length).padStart(2)} 个            ${human(p.modelBytes).padStart(9)}`);
  console.log(`   节点包 ${String(p.nodes.length).padStart(2)} 个          ${human(p.nodeBytes).padStart(9)}`);
  console.log(`   工作台源码              ${human(p.wbBytes).padStart(9)}`);
  console.log('   ────────────────────────────────');
  console.log(`   合计                    ${human(p.total).padStart(9)}`);
  console.log('');
  const volSize = 34 * 1024 ** 3;
  console.log(`  按 ${VOLUME} 切 → ${Math.ceil(p.total / volSize)} 个包`);
  console.log('');
  console.log('  打包: node scripts/make-big-volumes.mjs --make');
  return p;
};

const make = () => {
  const p = plan();
  if (!SEVEN_ZIP) {
    console.error('  找不到 7z.exe');
    return 1;
  }

  console.log('  建立暂存目录（硬链接，不占额外空间）…');
  rmSync(STAGE_BASE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });

  const skipCommon = new Set(['__pycache__', '.git', '.output', '.verify', '.tanstack', 'node_modules']);

  // manke/ComfyUI/python_embeded
  let r = linkDir(join(COMFY_ROOT, 'python_embeded'), join(STAGE, 'ComfyUI', 'python_embeded'), skipCommon);
  console.log(`    python_embeded  ${r.linked} 链接 / ${r.copied} 复制`);

  // manke/ComfyUI/ 本体（排除 models/custom_nodes/output 等）
  r = linkDir(
    COMFY_DIR,
    join(STAGE, 'ComfyUI'),
    new Set(['models', 'custom_nodes', 'output', 'input', 'temp', 'user', 'logs', '__pycache__'])
  );
  console.log(`    ComfyUI 本体    ${r.linked} 链接 / ${r.copied} 复制`);

  // manke/ComfyUI/models/…（保持原相对路径）
  let n = 0;
  for (const f of p.models) {
    const relPath = relative(join(COMFY_DIR, 'models'), f);
    const dst = join(STAGE, 'ComfyUI', 'models', relPath);
    mkdirSync(dirname(dst), { recursive: true });
    try {
      linkSync(f, dst);
      n += 1;
    } catch {
      writeFileSync(dst, readFileSync(f));
      n += 1;
    }
  }
  console.log(`    models          ${n} 个文件`);

  // manke/ComfyUI/custom_nodes/…
  n = 0;
  for (const d of p.nodes) {
    const dst = join(STAGE, 'ComfyUI', 'custom_nodes', d.split(/[\\/]/).pop());
    const rr = linkDir(d, dst, skipCommon);
    n += rr.linked + rr.copied;
  }
  console.log(`    custom_nodes    ${n} 个文件`);

  // manke/workbench/…
  n = 0;
  for (const item of WORKBENCH_ITEMS) {
    const src = join(ROOT, item);
    if (!existsSync(src)) continue;
    const dst = join(STAGE, 'workbench', item);
    const rr = linkDir(src, dst, skipCommon);
    n += rr.linked + rr.copied;
  }
  console.log(`    workbench       ${n} 个文件`);

  console.log('');
  console.log('  开始打包…');
  mkdirSync(OUT, { recursive: true });
  const archive = join(OUT, 'manke-bundle.7z');

  try {
    execFileSync(
      SEVEN_ZIP,
      ['a', '-mx0', '-t7z', `-v${VOLUME}`, archive, 'manke'],
      { cwd: STAGE_BASE, stdio: 'inherit' }
    );
  } catch (error) {
    console.error('  打包失败: ' + String(error).slice(0, 300));
    return 1;
  }

  const vols = readdirSync(OUT).filter((f) => /^manke-bundle\.7z\.\d+$/.test(f)).sort();
  const bytes = vols.reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
  console.log('');
  console.log(`  完成：${vols.length} 个包，合计 ${human(bytes)}`);
  console.log(`  目录：${OUT}`);
  return 0;
};

if (has('--make')) {
  process.exit(make());
}
plan();

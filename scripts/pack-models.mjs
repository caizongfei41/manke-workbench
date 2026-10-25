// 打包工作流必需的模型，保持 ComfyUI 的 models/ 目录结构
//
//   node scripts/pack-models.mjs --list        看一眼要打包哪些、多大
//   node scripts/pack-models.mjs --prepare     建立临时目录树，用硬链接指过去
//   node scripts/pack-models.mjs --clean       删掉临时目录
//
// 为什么用硬链接而不是复制：
//   230 GB 复制一遍要多占 230 GB，而 E: 盘只剩 36 GB。
//   硬链接是同一份数据换个名字，不占额外空间。夸克客户端上传时按普通文件读，
//   完全看不出来。
//
// 打包后的目录结构要能直接盖回 ComfyUI：
//   <out>/models/diffusion_models/MiniMax/xxx.safetensors
//   <out>/models/vae/xxx.safetensors
// 用户下载解压后把 models 文件夹拖进 ComfyUI 根目录即可。
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MANIFEST = join(ROOT, 'docs/DEPENDENCIES.json');
const SOURCES = join(ROOT, 'data/install-sources.json');
const CONFIG = join(ROOT, 'data/comfyui.config.json');
// 打包目录放在 ComfyUI 所在的盘上 —— 硬链接不能跨分区。
// 想换位置用 BEATDESIGN_PACK_DIR 覆盖。
/**
 * 打包输出目录。放在 ComfyUI 所在的盘上 —— 硬链接不能跨分区，
 * 放到别的盘会退化成复制，多占 197 GB。
 * 惰性求值：模块顶层还没读到配置，此时算路径会拿到默认值。
 */
const packDir = () => process.env.BEATDESIGN_PACK_DIR ?? join(resolveComfyRoot(), '_model-bundle');

const args = new Set(process.argv.slice(2));

const resolveComfyRoot = () => {
  if (process.env.BEATDESIGN_COMFYUI_HOME) return process.env.BEATDESIGN_COMFYUI_HOME;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const py = String(cfg.pythonPath ?? '');
    const idx = py.toLowerCase().indexOf('python_embeded');
    if (idx > 0) return py.slice(0, idx).replace(/[\\/]+$/, '');
  } catch {
    /* fall through */
  }
  return 'E:\\ComfyUI';
};

const COMFY_DIR = join(resolveComfyRoot(), 'ComfyUI');
const MODELS_DIR = join(COMFY_DIR, 'models');

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const manifest = readJson(MANIFEST, { files: [] });
const sources = readJson(SOURCES, { models: {} });

/** 在 models/ 下按文件名找真实路径。 */
const indexModels = () => {
  const map = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!map.has(entry.name)) map.set(entry.name, full);
    }
  };
  walk(MODELS_DIR);
  return map;
};

const humanSize = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

/** 收集要打包的文件：manifest 里引用的、确实存在的。 */
const collect = () => {
  const index = indexModels();
  const items = [];
  const skipped = [];
  // 同一个文件可能被多个模板引用（清单里出现两次），打包时只该算一次
  const seen = new Set();
  for (const file of manifest.files ?? []) {
    const base = file.basename;
    const hit = index.get(base);
    if (!hit) {
      skipped.push(base);
      continue;
    }
    if (seen.has(hit)) continue;
    seen.add(hit);
    // 目标路径沿用它在 ComfyUI/models 下的真实相对位置，
    // 这样解压后可以直接盖回去，不用猜该放哪个子目录。
    const rel = relative(MODELS_DIR, hit);
    items.push({ name: base, source: hit, rel, size: statSync(hit).size });
  }
  return { items, skipped };
};

const main = () => {
  const { items, skipped } = collect();
  const total = items.reduce((sum, item) => sum + item.size, 0);

  if (args.has('--clean')) {
    if (existsSync(packDir())) {
      rmSync(packDir(), { recursive: true, force: true });
      console.log(`  已删除 ${packDir()}`);
    } else {
      console.log('  临时目录不存在');
    }
    return;
  }

  console.log(`  ComfyUI 模型目录: ${MODELS_DIR}`);
  console.log(`  清单引用 ${(manifest.files ?? []).length} 项，找到 ${items.length} 项`);
  console.log(`  合计 ${humanSize(total)}`);
  if (skipped.length) {
    console.log(`  未找到 ${skipped.length} 项（跳过）：`);
    for (const s of skipped.slice(0, 5)) console.log(`    ${s}`);
  }

  if (args.has('--list') || !args.has('--prepare')) {
    console.log('');
    console.log('  明细：');
    for (const item of items.sort((a, b) => b.size - a.size)) {
      console.log(`   ${humanSize(item.size).padStart(9)}  models/${item.rel.split(sep).join('/')}`);
    }
    console.log('');
    console.log('  建立打包目录：node scripts/pack-models.mjs --prepare');
    return;
  }

  // ── 建目录树 + 硬链接
  rmSync(packDir(), { recursive: true, force: true });
  let linked = 0;
  let failed = 0;
  for (const item of items) {
    const target = join(packDir(), 'models', item.rel);
    mkdirSync(dirname(target), { recursive: true });
    try {
      // 同一分区才能硬链接；跨盘会抛 EXDEV，这时退回复制并告警
      linkSync(item.source, target);
      linked += 1;
    } catch (error) {
      if (error.code === 'EXDEV') {
        console.error(`  ${item.name}: 跨分区，硬链接不可用`); 
      }
      failed += 1;
    }
  }
  console.log('');
  console.log(`  已建立 ${linked} 个硬链接，失败 ${failed} 个`);
  console.log(`  打包目录: ${packDir()}`);
  console.log('  这是硬链接，不占额外空间；删除临时目录不影响原文件。');
};

main();

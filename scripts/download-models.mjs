// 模型下载器
//
//   node scripts/download-models.mjs                   核对并列出缺什么
//   node scripts/download-models.mjs --id 3            下载第 3 项
//   node scripts/download-models.mjs --missing         下载全部缺失项
//   node scripts/download-models.mjs --list --json     给 UI 读的机器格式
//
// 为什么用 curl 而不是 huggingface_hub：
//   ComfyUI 的 Python 环境里装了 huggingface_hub，但它默认 HF_HUB_OFFLINE，
//   而且镜像站 hf-mirror.com 对 HEAD 请求返回 308，客户端会当成读超时放弃。
//   curl 直接打 resolve URL，能跟重定向，也不需要 Python 那套缓存逻辑。
//
// 下载路径从 data/install-sources.json 的 dir 字段来，落到 ComfyUI/models/<dir>/。
import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MANIFEST = join(ROOT, 'docs/DEPENDENCIES.json');
const SOURCES = join(ROOT, 'data/install-sources.json');
const CONFIG = join(ROOT, 'data/comfyui.config.json');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

/** ComfyUI 安装根：优先环境变量，其次从配置里的 pythonPath 反推。 */
const resolveComfyRoot = () => {
  if (process.env.BEATDESIGN_COMFYUI_HOME) return process.env.BEATDESIGN_COMFYUI_HOME;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const py = String(cfg.pythonPath ?? '');
    const idx = py.toLowerCase().indexOf('python_embeded');
    if (idx > 0) return py.slice(0, idx).replace(/[\\/]+$/, '');
  } catch {
    /* 配置缺失时用默认 */
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

/** 已安装的文件名集合（只收 models/ 下，够判断存在性）。 */
const indexInstalled = () => {
  const found = new Set();
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
      else found.add(entry.name);
    }
  };
  walk(MODELS_DIR);
  return found;
};

/**
 * 把文件名映射到下载地址。
 *
 * huggingface 的直链格式是
 *   https://huggingface.co/<repo>/resolve/main/<path>
 * 我们只知道文件名，不知道仓库和仓库内路径，所以 sources 里要写明 repo。
 * 没写 repo 的条目（社区量化版、作者网盘）不生成直链，只给搜索页。
 */
const buildDownloadUrl = (basename, source) => {
  if (!source) return null;
  if (source.downloadUrl) return source.downloadUrl;
  if (source.repo && source.path) {
    const host = source.host ?? 'https://huggingface.co';
    return `${host}/${source.repo}/resolve/main/${source.path}`;
  }
  return null;
};

const humanSize = (bytes) => {
  if (!bytes) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

/** 组装清单：缺什么、多大、从哪下、放到哪。 */
const buildPlan = () => {
  const installed = indexInstalled();
  const plan = [];
  for (const file of manifest.files ?? []) {
    const base = file.basename;
    const source = sources.models?.[base] ?? null;
    const present = installed.has(base) || base.includes('/');
    if (present) continue;
    plan.push({
      name: base,
      templates: file.templates ?? [],
      dir: source?.dir ?? '',
      kind: source?.kind ?? '',
      note: source?.note ?? '',
      url: buildDownloadUrl(base, source) ?? '',
      page: source?.url ?? '',
      required: true,
    });
  }
  return plan;
};

/** 用 curl 下载，支持断点续传（-C -）。 */
const download = (item) =>
  new Promise((resolve) => {
    const targetDir = item.dir ? join(MODELS_DIR, item.dir) : MODELS_DIR;
    mkdirSync(targetDir, { recursive: true });
    const target = join(targetDir, item.name);
    if (existsSync(target) && statSync(target).size > 0) {
      resolve({ ok: true, skipped: true, target });
      return;
    }
    const part = `${target}.part`;
    const child = spawn(
      'curl',
      ['-L', '--fail', '--retry', '3', '--retry-delay', '5', '-C', '-', '-o', part, item.url],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0 && existsSync(part)) {
        try {
          renameSync(part, target);
          resolve({ ok: true, target });
        } catch (error) {
          resolve({ ok: false, error: String(error) });
        }
      } else {
        try {
          unlinkSync(part);
        } catch {
          /* 半成品删不掉也不影响下一轮 */
        }
        resolve({ ok: false, error: stderr.slice(0, 200) || `curl exit ${code}` });
      }
    });
    child.on('error', (error) => resolve({ ok: false, error: String(error) }));
  });

const main = async () => {
  const plan = buildPlan();

  if (has('--json')) {
    console.log(JSON.stringify({ modelsDir: MODELS_DIR, missing: plan }, null, 2));
    return;
  }

  if (!has('--id') && !has('--missing')) {
    console.log(`  ComfyUI 模型目录: ${MODELS_DIR}`);
    if (plan.length === 0) {
      console.log('  所有模型就位，没有需要下载的');
      return;
    }
    console.log(`  缺失 ${plan.length} 项：`);
    for (const [i, item] of plan.entries()) {
      const size = humanSize(item.size);
      const where = item.dir ? `models/${item.dir}` : 'models/';
      console.log(`   ${String(i + 1).padStart(2)}. ${item.name}${size ? `  ${size}` : ''}`);
      console.log(`       放置 → ${where}`);
      if (item.url) console.log(`       下载 → ${item.url}`);
      else if (item.page) console.log(`       页面 → ${item.page}（需手动下载）`);
    }
    console.log('');
    console.log('  下载全部可直连的：node scripts/download-models.mjs --missing');
    console.log('  下载单个：       node scripts/download-models.mjs --id 1');
    return;
  }

  const picks = has('--missing')
    ? plan.filter((item) => item.url)
    : (() => {
        const idx = Number(valueOf('--id')) - 1;
        return plan[idx] ? [plan[idx]] : [];
      })();

  if (picks.length === 0) {
    console.log('  没有可下载的项（检查 id，或该模型没有直链）');
    return;
  }

  for (const [i, item] of picks.entries()) {
    console.log(`  [${i + 1}/${picks.length}] ${item.name}`);
    if (!item.url) {
      console.log(`       没有直链，去 ${item.page || '来源页'} 手动下载`);
      continue;
    }
    const result = await download(item);
    if (result.ok) {
      console.log(`       ${result.skipped ? '已存在，跳过' : '完成'} → ${result.target}`);
    } else {
      console.log(`       失败: ${result.error}`);
    }
  }
};

await main();

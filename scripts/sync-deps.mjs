#!/usr/bin/env node
// 检查并补齐工作台更新后新增的模型 / 节点包
//
//   node scripts/sync-deps.mjs --check                          只看缺什么
//   node scripts/sync-deps.mjs --sync                           全部补齐
//   node scripts/sync-deps.mjs --sync --only=nodes              只补节点包
//   node scripts/sync-deps.mjs --sync --only=models             只补模型
//
// 为什么需要这个脚本：
//   工作台更新只换代码（12 MB tarball）。新版功能可能需要新的模型或节点包，
//   那些动辄几百 GB，不可能塞进 tarball。
//   这个脚本读最新的 DEPENDENCIES.json，和本地磁盘比对，列出差什么。
//
// 为什么不自动下载：
//   模型 200 GB。用户可能磁盘不够、只想用图片功能、或者在流量计费的网络上。
//   代码可以自动更新，资源必须用户点确认。
//
// 用 --json 输出机器可读结果，控制台读它来决定是否点亮「补齐依赖」按钮。
import { execFileSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

/** 工作台根目录。--root 指定，或从脚本位置上推两级。 */
const resolveRoot = () => {
  const explicit = valueOf('--root');
  if (explicit) return resolve(explicit);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
};

const ROOT = resolveRoot();
const MANIFEST = join(ROOT, 'docs', 'DEPENDENCIES.json');
const SOURCES = join(ROOT, 'data', 'install-sources.json');
const CONFIG = join(ROOT, 'data', 'comfyui.config.json');

const readJson = (path, fallback) => {
  try {
    // PowerShell 写出来的文件可能带 BOM，JSON.parse 会炸。
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
};

/** ComfyUI 安装根目录：从 comfyui.config.json 的 pythonPath 反推。 */
const resolveComfyRoot = () => {
  if (process.env.BEATDESIGN_COMFYUI_HOME) return process.env.BEATDESIGN_COMFYUI_HOME;
  const cfg = readJson(CONFIG, {});
  const py = String(cfg.pythonPath ?? '');
  const idx = py.toLowerCase().indexOf('python_embeded');
  if (idx > 0) return py.slice(0, idx).replace(/[\\/]+$/, '');
  return null;
};

const human = (bytes) => {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

/**
 * 扫本地 ComfyUI 的 models/ 目录，建一个 basename → 路径 的索引。
 *
 * 按 basename 而不是完整路径匹配，因为不同人的目录结构可能不一样
 * （models/checkpoints/ 还是 models/unet/），但文件名是固定的。
 */
const scanLocalModels = (comfyDir) => {
  const index = new Map();
  if (!comfyDir) return index;
  const modelsDir = join(comfyDir, 'models');
  if (!existsSync(modelsDir)) return index;

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        try {
          index.set(e.name, { path: full, size: statSync(full).size });
        } catch {
          /* 读不到就跳过 */
        }
      }
    }
  };
  walk(modelsDir);
  return index;
};

/** 扫本地 custom_nodes/，返回已有的节点包目录名集合。 */
const scanLocalNodes = (comfyDir) => {
  const set = new Set();
  if (!comfyDir) return set;
  const nodesDir = join(comfyDir, 'custom_nodes');
  if (!existsSync(nodesDir)) return set;
  try {
    for (const e of readdirSync(nodesDir, { withFileTypes: true })) {
      if (e.isDirectory()) set.add(e.name);
    }
  } catch {
    /* 忽略 */
  }
  return set;
};

/** 真正的模型文件扩展名。清单里其他东西是工作流素材，不该当模型检查。 */
const MODEL_EXTENSIONS = new Set(['safetensors', 'gguf', 'pth', 'pt', 'ckpt', 'bin', 'onnx']);

/** 判断清单条目是不是模型文件。 */
const isModelEntry = (name) => {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (MODEL_EXTENSIONS.has(ext)) return true;
  // 目录形式的模型（如 Qwen3-TTS-12Hz-1.7B-CustomVoice）没有扩展名，
  // 但它在 models/ 下是个目录。这里只认带已知扩展名的，
  // 否则会把工作流里的参考图目录也当成模型。
  return false;
};

/** 从清单里取出「这个工作流集需要哪些模型」。 */
const requiredModels = (manifest) => {
  const byName = new Map();
  for (const f of manifest.files ?? []) {
    const base = String(f.basename ?? f.name ?? '');
    if (!base) continue;
    if (!isModelEntry(base)) continue;
    if (!byName.has(base)) {
      byName.set(base, { basename: base, templates: [] });
    }
    byName.get(base).templates.push(...(f.templates ?? []));
  }
  return [...byName.values()];
};

/**
 * 目录形式的模型（TTS 语音包之类）。
 * 清单里没有扩展名但确实是模型的条目，单独列出来，
 * 检查时按目录是否存在判断。
 */
const requiredModelDirs = (manifest) => {
  const out = new Map();
  for (const f of manifest.files ?? []) {
    const base = String(f.basename ?? f.name ?? '');
    if (!base || isModelEntry(base)) continue;
    // 有扩展名但不是模型扩展名 → 是素材，跳过
    if (base.includes('.')) continue;
    out.set(base, { basename: base, templates: f.templates ?? [] });
  }
  return [...out.values()];
};

/** 从清单里取出需要的节点包名。 */
const requiredNodes = (manifest) =>
  (manifest.nodePackages ?? []).map((p) => String(p.name ?? '')).filter(Boolean);

/**
 * 找某个资源的下载源。
 * install-sources.json 里 models 用文件名当 key，nodes 用包名。
 */
const findSources = (sources, kind, name) => {
  if (kind === 'models') {
    const entry = sources.models?.[name];
    if (!entry) return [];
    return Array.isArray(entry) ? entry : [entry];
  }
  const entry = sources.nodes?.[name];
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
};

/** 目标盘的剩余空间。 */
const freeSpaceAt = (path) => {
  try {
    const drive = /^[A-Za-z]:/.exec(path)?.[0];
    if (!drive) return null;
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-PSDrive ${drive[0]}).Free`],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 }
    ).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

/** 检查：返回缺失清单，不修改任何文件。 */
const check = () => {
  const manifest = readJson(MANIFEST, { files: [], nodePackages: [] });
  const sources = readJson(SOURCES, { models: {}, nodes: {} });
  const comfyRoot = resolveComfyRoot();
  const comfyDir = comfyRoot ? join(comfyRoot, 'ComfyUI') : null;

  const localModels = scanLocalModels(comfyDir);
  const localNodes = scanLocalNodes(comfyDir);

  const missingModels = [];
  for (const m of requiredModels(manifest)) {
    if (localModels.has(m.basename)) continue;
    const srcs = findSources(sources, 'models', m.basename);
    missingModels.push({
      basename: m.basename,
      templates: [...new Set(m.templates)],
      sources: srcs,
      kind: 'file',
      downloadable: srcs.length > 0,
    });
  }

  // 目录型模型（语音包等）：按 custom_nodes 之外的方式找
  for (const m of requiredModelDirs(manifest)) {
    const dirCandidates = [
      join(comfyDir ?? '', 'models', 'tts', m.basename),
      join(comfyDir ?? '', 'models', m.basename),
    ];
    if (dirCandidates.some((p) => existsSync(p))) continue;
    const srcs = findSources(sources, 'models', m.basename);
    missingModels.push({
      basename: m.basename,
      templates: [...new Set(m.templates)],
      sources: srcs,
      kind: 'dir',
      downloadable: srcs.length > 0,
    });
  }

  const missingNodes = [];
  for (const name of requiredNodes(manifest)) {
    if (localNodes.has(name)) continue;
    const srcs = findSources(sources, 'nodes', name);
    missingNodes.push({
      name,
      sources: srcs,
      downloadable: srcs.length > 0,
    });
  }

  // 本地有但清单没引用的模型 —— 不删，只提示可以手动清理
  const requiredSet = new Set(requiredModels(manifest).map((m) => m.basename));
  const orphanModels = [...localModels.entries()]
    .filter(([name]) => !requiredSet.has(name))
    .map(([name, info]) => ({ basename: name, sizeBytes: info.size }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    comfyRoot,
    ready: Boolean(comfyDir) && existsSync(join(comfyDir, 'models')),
    missingModels,
    missingNodes,
    orphanModels,
    summary: {
      missingModels: missingModels.length,
      missingNodes: missingNodes.length,
      downloadable: missingModels.filter((m) => m.downloadable).length +
        missingNodes.filter((n) => n.downloadable).length,
      manualOnly: missingModels.filter((m) => !m.downloadable).length +
        missingNodes.filter((n) => !n.downloadable).length,
    },
  };
};

/** 下载单个文件，支持断点续传。 */
const downloadFile = async (url, dest, expectedSize) => {
  mkdirSync(dirname(dest), { recursive: true });

  // 已存在且大小一致就跳过 —— 避免重复下载 200 GB
  if (existsSync(dest) && expectedSize) {
    const size = statSync(dest).size;
    if (size === expectedSize) return { ok: true, skipped: true };
  }

  const res = await fetch(url, {
    headers: { 'user-agent': 'manke-workbench-sync' },
    redirect: 'follow',
    signal: AbortSignal.timeout(6 * 60 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return { ok: true, skipped: false };
};

/** 用 git clone --depth 1 装节点包；没 git 就下 zip。 */
const installNode = async (name, sources) => {
  const comfyRoot = resolveComfyRoot();
  if (!comfyRoot) throw new Error('还没指定 ComfyUI 位置');
  const dest = join(comfyRoot, 'ComfyUI', 'custom_nodes', name);

  const src = sources.find((s) => s.url);
  if (!src) throw new Error('没有下载地址');

  // GitHub 仓库优先用 git，能拿到完整包
  if (src.url.includes('github.com')) {
    try {
      execFileSync('git', ['clone', '--depth', '1', src.url, dest], {
        stdio: 'pipe',
        timeout: 300_000,
      });
      return { ok: true, method: 'git' };
    } catch {
      /* 没 git 或失败，退回 zip */
    }
    const zipUrl = `${src.url.replace(/\.git$/, '')}/archive/refs/heads/main.zip`;
    const tmp = join(process.env.TEMP ?? '/tmp', `${name}.zip`);
    await downloadFile(zipUrl, tmp);
    return { ok: true, method: 'zip', zipPath: tmp, dest };
  }

  throw new Error(`不支持的来源：${src.url}`);
};

const sync = async (only) => {
  const report = check();
  if (!report.ready) {
    console.log('找不到 ComfyUI 的 models 目录。先点控制台「ComfyUI 位置」指定。');
    return 1;
  }

  const wantModels = !only || only === 'models';
  const wantNodes = !only || only === 'nodes';

  let done = 0;
  let failed = 0;

  if (wantNodes && report.missingNodes.length) {
    console.log(`补齐 ${report.missingNodes.length} 个节点包…`);
    for (const n of report.missingNodes) {
      if (!n.downloadable) {
        console.log(`  跳过 ${n.name}（没有下载地址，需手动安装）`);
        failed += 1;
        continue;
      }
      process.stdout.write(`  ${n.name} … `);
      try {
        const r = await installNode(n.name, n.sources);
        console.log(`OK (${r.method})`);
        done += 1;
      } catch (e) {
        console.log(`失败：${e.message}`);
        failed += 1;
      }
    }
  }

  if (wantModels && report.missingModels.length) {
    console.log(`补齐 ${report.missingModels.length} 个模型…`);
    const target = join(resolveComfyRoot(), 'ComfyUI', 'models');
    const free = freeSpaceAt(target);

    for (const m of report.missingModels) {
      if (!m.downloadable) {
        console.log(`  跳过 ${m.basename}（需去网盘手动下载）`);
        failed += 1;
        continue;
      }
      const src = m.sources.find((s) => s.url && !s.url.includes('pan.quark.cn'));
      if (!src) {
        console.log(`  跳过 ${m.basename}（只有网盘链接，需手动下）`);
        failed += 1;
        continue;
      }
      process.stdout.write(`  ${m.basename} … `);
      try {
        // 下载到什么子目录？按清单里的原始路径
        const dest = join(target, m.destPath ?? m.basename);
        const r = await downloadFile(src.url, dest, m.sizeBytes);
        console.log(r.skipped ? '已存在，跳过' : 'OK');
        done += 1;
      } catch (e) {
        console.log(`失败：${e.message}`);
        failed += 1;
      }
    }
  }

  console.log('');
  console.log(`完成：${done} 个成功，${failed} 个需手动处理`);
  return failed > 0 ? 1 : 0;
};

const main = async () => {
  try {
    process.stdout.reconfigure?.({ encoding: 'utf8', errors: 'replace' });
  } catch {
    /* 忽略 */
  }

  if (has('--json')) {
    console.log(JSON.stringify(check(), null, 2));
    return 0;
  }

  const report = check();

  if (has('--check')) {
    console.log(`ComfyUI：${report.comfyRoot ?? '（未指定）'}`);
    if (!report.ready) {
      console.log('找不到 models 目录。先点控制台「ComfyUI 位置」。');
      return 1;
    }
    console.log('');
    if (report.missingModels.length === 0 && report.missingNodes.length === 0) {
      console.log('依赖齐全，没有缺失。');
    } else {
      if (report.missingModels.length) {
        console.log(`缺 ${report.missingModels.length} 个模型：`);
        for (const m of report.missingModels) {
          const tag = m.downloadable ? '可自动下载' : '需手动下载';
          console.log(`  ${m.basename}  (${tag})`);
          if (m.templates.length) {
            console.log(`    用于：${m.templates.slice(0, 2).join('、')}`);
          }
        }
      }
      if (report.missingNodes.length) {
        console.log(`缺 ${report.missingNodes.length} 个节点包：`);
        for (const n of report.missingNodes) {
          const tag = n.downloadable ? '可自动安装' : '需手动安装';
          console.log(`  ${n.name}  (${tag})`);
        }
      }
    }
    if (report.orphanModels.length) {
      const total = report.orphanModels.reduce((s, m) => s + m.sizeBytes, 0);
      console.log('');
      console.log(`另有 ${report.orphanModels.length} 个模型不再被任何工作流引用，共 ${human(total)}：`);
      for (const m of report.orphanModels.slice(0, 5)) {
        console.log(`  ${m.basename}  ${human(m.sizeBytes)}`);
      }
      if (report.orphanModels.length > 5) console.log(`  …还有 ${report.orphanModels.length - 5} 个`);
      console.log('（不会自动删除，需要的话自己清理）');
    }
    return 0;
  }

  if (has('--sync')) {
    return await sync(valueOf('--only'));
  }

  // 无参数：等同 --check
  console.log('用法：');
  console.log('  node scripts/sync-deps.mjs --check            只看缺什么');
  console.log('  node scripts/sync-deps.mjs --sync             全部补齐');
  console.log('  node scripts/sync-deps.mjs --sync --only=nodes  只补节点包');
  console.log('  node scripts/sync-deps.mjs --json             机器可读输出');
  return 0;
};

main().then((code) => process.exit(code));

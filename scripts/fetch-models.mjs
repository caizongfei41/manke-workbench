// 模型依赖核对与下载指引
//
//   node scripts/fetch-models.mjs            只核对，列出缺什么
//   node scripts/fetch-models.mjs --list     打印完整清单（可粘贴到下载工具）
//   node scripts/fetch-models.mjs --write    把清单写到 .verify/models-checklist.md
//
// 为什么不做自动下载：
//   这套工作流的模型合计 200 GB 以上，主模型单个 32 GB。来源分散在 HuggingFace、
//   ModelScope、Civitai 和作者自己的网盘，没有统一的公开 URL，写死下载地址第二天就失效。
//   这个脚本负责的是「核对」——告诉你缺哪个、该放哪、多大，
//   然后按 .verify/models-checklist.md 里的来源自己拉。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WF_DIR = join(ROOT, 'data/comfyui/workflows');
const COMFY_DIR =
  process.env.BEATDESIGN_COMFYUI_HOME ?? process.argv[2] ?? 'E:\\ComfyUI\\ComfyUI';
const MODELS_DIR = join(COMFY_DIR, 'models');
const OUT_DIR = join(ROOT, '.verify');

const args = new Set(process.argv.slice(2));

if (!existsSync(MODELS_DIR)) {
  console.error(`  找不到模型目录：${MODELS_DIR}`);
  console.error('  用 --help 看怎么指定路径，或设置 BEATDESIGN_COMFYUI_HOME');
  process.exit(1);
}

/** 模板里写死的文件名 → 用到它的模板 */
const collectRequired = () => {
  const usage = new Map();
  for (const file of readdirSync(WF_DIR).filter((f) => f.endsWith('.json'))) {
    let workflow;
    try {
      workflow = JSON.parse(readFileSync(join(WF_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    for (const node of Object.values(workflow)) {
      for (const value of Object.values(node?.inputs ?? {})) {
        if (typeof value !== 'string') continue;
        if (!/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i.test(value)) continue;
        if (!usage.has(value)) usage.set(value, new Set());
        usage.get(value).add(file);
      }
    }
  }
  return usage;
};

/** 扫一遍本机 models/，按文件名建索引 */
const indexInstalled = () => {
  const index = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (!index.has(entry.name)) {
        index.set(entry.name, {
          rel: relative(COMFY_DIR, full).split(sep).join('/'),
          size: statSync(full).size,
        });
      }
    }
  };
  walk(MODELS_DIR);
  return index;
};

const human = (bytes) => {
  if (!bytes) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

const required = collectRequired();
const installed = indexInstalled();

const rows = [];
for (const [name, usedBy] of [...required.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const base = name.split(/[\\/]/).pop();
  const hit = installed.get(base);
  rows.push({
    name,
    base,
    usedBy: [...usedBy].sort(),
    installed: hit ?? null,
    size: hit?.size ?? 0,
  });
}

const present = rows.filter((r) => r.installed);
const missing = rows.filter((r) => !r.installed);
const totalBytes = present.reduce((sum, r) => sum + r.size, 0);

console.log(`  ComfyUI: ${COMFY_DIR}`);
console.log(`  模板引用模型 ${rows.length} 个`);
console.log(`  已安装 ${present.length} 个，合计 ${human(totalBytes)}`);
if (missing.length) {
  console.log(`  缺失 ${missing.length} 个：`);
  for (const row of missing) {
    console.log(`    ${row.name}  ← ${row.usedBy.join(', ')}`);
  }
} else {
  console.log('  没有缺失');
}

if (args.has('--list')) {
  console.log('');
  for (const row of rows) {
    const where = row.installed ? row.installed.rel : '（缺失）';
    console.log(`${where}\t${human(row.size)}`);
  }
}

if (args.has('--write')) {
  mkdirSync(OUT_DIR, { recursive: true });
  const lines = [
    '# 模型清单',
    '',
    `生成时间：${new Date().toISOString()}`,
    `ComfyUI 根目录：\`${COMFY_DIR}\``,
    '',
    `已安装 ${present.length} 个 / 合计 ${human(totalBytes)}；缺失 ${missing.length} 个。`,
    '',
    '| 文件名 | 大小 | 本机路径（相对 ComfyUI 根） | 使用模板 |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const where = row.installed ? `\`${row.installed.rel}\`` : '**缺失**';
    lines.push(`| \`${row.name}\` | ${human(row.size)} | ${where} | ${row.usedBy.join('<br>')} |`);
  }
  const target = join(OUT_DIR, 'models-checklist.md');
  writeFileSync(target, lines.join('\n') + '\n', 'utf8');
  console.log('');
  console.log(`  已写入 ${target}`);
}

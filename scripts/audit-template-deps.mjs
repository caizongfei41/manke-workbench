// Map required node classes to the ComfyUI custom-node packages that provide them.
//
// ComfyUI's /object_info reports a `python_module` for every registered class, so
// the mapping comes from the running instance rather than from guessing at folder
// names. The result is the install list for a new machine: which node packages to
// copy, and which classes each one has to keep providing.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.argv[2] ?? process.cwd();
const COMFY = process.argv[3] ?? 'http://127.0.0.1:8188';
// Filesystem root of the ComfyUI install; separate from the URL above.
const COMFY_DIR = process.argv[4] ?? process.env.BEATDESIGN_COMFYUI_HOME ?? 'E:\\ComfyUI';
const WF_DIR = join(ROOT, 'data/comfyui/workflows');
const OUT = join(ROOT, 'docs/DEPENDENCIES.md');

// 安装渠道（下载地址、整包来源）。与 check-environment.mjs 读同一份。
let sources = { runtime: {}, bundles: [], nodes: {}, models: {} };
try {
  sources = JSON.parse(readFileSync(join(ROOT, 'data/install-sources.json'), 'utf8'));
} catch {
  // 没有渠道文件也能生成清单，只是少了「从哪儿装」那一节
}

const CORE_NODES = new Set([
  'KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'CheckpointLoaderSimple',
  'CLIPTextEncode', 'CLIPSetLastLayer', 'EmptyLatentImage', 'VAEDecode', 'VAEEncode',
  'VAEDecodeTiled', 'VAEEncodeTiled', 'SaveImage', 'PreviewImage', 'LoadImage',
  'ConditioningCombine', 'ConditioningConcat', 'ConditioningSetArea',
  'LatentUpscale', 'LatentUpscaleBy', 'ImageScale', 'ImageScaleBy',
  'ImageUpscaleWithModel', 'UpscaleModelLoader', 'LoraLoader', 'LoraLoaderModelOnly',
  'UNETLoader', 'DualCLIPLoader', 'CLIPLoader', 'VAELoader', 'ModelSamplingAuraFlow',
  'ModelSamplingSD3', 'ModelMergeSimple', 'ImageBatch', 'ImageBlend', 'GetImageSize',
  'SetLatentNoiseMask', 'InpaintModelConditioning', 'RepeatLatentBatch',
  'ImageFromBatch', 'ImageCompositeMasked', 'GrowMask', 'MaskBlur', 'SolidMask',
  'ControlNetApplyAdvanced', 'ControlNetLoader', 'LoadImageMask', 'ImageCrop',
  'ImagePadForOutpaint', 'FreeU', 'FreeU_V2', 'Note', 'Reroute', 'PrimitiveNode',
  'FluxGuidance', 'CLIPVisionLoader', 'CLIPVisionEncode', 'StyleModelLoader',
  'StyleModelApply', 'EmptySD3LatentImage', 'ModelSamplingFlux', 'SetNode',
  'GetNode', 'ImageInvert', 'ThresholdMask',
]);

const FILE_KEYS = [
  'ckpt_name', 'unet_name', 'vae_name', 'clip_name', 'clip_name1', 'clip_name2',
  'clip_vision_name', 'style_model_name', 'lora_name', 'upscale_model',
  'control_net_name', 'model_name', 'dit_model', 'vae_model', 'gguf_name',
  'image', 'audio', 'file',
  // AICG3D_H3Loader：模型不是按 *Loader 节点名放的，而是这个聚合节点上的槽位。
  'fl2va_model', 'ref2va_model', 'text_encoder', 'video_vae', 'audio_vae',
  'lora_1', 'lora_2', 'lora_3', 'lora_4', 'lora_5', 'lora_6', 'lora_7',
  'lora_8', 'lora_9',
];
const EXCLUDE_VALUES = /^(none|auto|null|)$/i;

// ── templates
const nodeUsage = new Map();
const fileUsage = new Map();
const byTemplate = [];
const templates = readdirSync(WF_DIR).filter((f) => f.endsWith('.json'));

for (const name of templates) {
  const raw = JSON.parse(readFileSync(join(WF_DIR, name), 'utf8'));
  const graph = raw.prompt && typeof raw.prompt === 'object' ? raw.prompt : raw;
  const classes = new Set();
  const files = new Set();
  for (const node of Object.values(graph)) {
    if (!node || typeof node !== 'object') continue;
    if (typeof node.class_type === 'string') {
      classes.add(node.class_type);
      if (!nodeUsage.has(node.class_type)) nodeUsage.set(node.class_type, new Set());
      nodeUsage.get(node.class_type).add(name);
    }
    if (!node.inputs || typeof node.inputs !== 'object') continue;
    for (const [k, v] of Object.entries(node.inputs)) {
      if (!FILE_KEYS.includes(k) || typeof v !== 'string' || EXCLUDE_VALUES.test(v)) continue;
      files.add(v);
      if (!fileUsage.has(v)) fileUsage.set(v, new Set());
      fileUsage.get(v).add(name);
    }
  }
  byTemplate.push({ name, classes, files });
}

const customClasses = [...nodeUsage.keys()].filter((c) => !CORE_NODES.has(c)).sort();

// ── running ComfyUI
let info = {};
try {
  const res = await fetch(`${COMFY}/object_info`, { signal: AbortSignal.timeout(30000) });
  info = await res.json();
} catch (e) {
  console.error(`无法读取 ${COMFY}/object_info: ${e.message}`);
  process.exit(1);
}

const moduleOf = new Map();
for (const [cls, meta] of Object.entries(info)) {
  const mod = meta?.python_module;
  if (typeof mod === 'string') moduleOf.set(cls, mod);
}

// The module name in /object_info is not always the folder name: a package can
// register itself under a shorter name than its directory. Resolve against the
// real custom_nodes listing so the install instructions name a directory that
// actually exists.
// COMFY_DIR is the ComfyUI install root itself (the one holding models/ and
// main.py), so custom_nodes sits directly under it. This used to append an
// extra 'ComfyUI' segment, which pointed at a path that does not exist on a
// standard install -- the folder listing came back empty, name resolution fell
// through to the raw /object_info module name, and the manifest ended up
// naming "Comfyui-Qwen-Image-2" for a directory actually called
// "Comfyui-Qwen-Image-2.1-BlockCache-T8". The environment check then reported
// a missing package that was installed all along.
const cnDir = join(COMFY_DIR, 'custom_nodes');
let cnFolders = [];
try {
  cnFolders = readdirSync(cnDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
} catch {
  // custom_nodes not readable; fall back to the reported module name.
}

const packageOf = (mod) => {
  if (!mod) return null;
  // Greedy to the end: package folders routinely contain dots
  // ("Comfyui-Qwen-Image-2.1-BlockCache-T8"), and a non-greedy [^.]+ stops at
  // the version number, producing a name that matches no directory.
  const m = /^custom_nodes\.(.+)$/.exec(mod);
  if (!m) {
    if (/^comfy_extras/.test(mod)) return '(comfy_extras)';
    if (/^nodes$|^comfy\./.test(mod)) return '(core)';
    return mod;
  }
  const reported = m[1];
  if (cnFolders.includes(reported)) return reported;
  // Prefer a folder that starts with the reported name ("Comfyui-Qwen-Image-2" ->
  // "Comfyui-Qwen-Image-2.1-BlockCache-T8").
  const lower = reported.toLowerCase();
  const prefixed = cnFolders
    .filter((f) => f.toLowerCase().startsWith(lower))
    .sort((a, b) => a.length - b.length);
  return prefixed[0] ?? reported;
};

const byPackage = new Map(); // package -> Set(class)
const missing = [];
for (const cls of customClasses) {
  const pkg = packageOf(moduleOf.get(cls));
  if (!pkg) { missing.push(cls); continue; }
  if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
  byPackage.get(pkg).add(cls);
}

// ── write report
const L = [];
L.push('# 依赖清单');
L.push('');
L.push('> 由 `scripts/audit-template-deps.mjs` 生成。模板或环境变化后重新跑一次即可更新。');
L.push('');
L.push(`- 模板：**${templates.length}** 个`);
L.push(`- 核心之外的自定义节点类：**${customClasses.length}** 个`);
L.push(`- 需要的自定义节点包：**${[...byPackage.keys()].filter((p) => !p.startsWith('(')).length}** 个`);
L.push(`- 模型 / 资源文件：**${fileUsage.size}** 个`);
L.push('');

// ── 安装渠道
// 换机器部署时最先问的就是「这些文件从哪儿下」。渠道数据在
// data/install-sources.json，这里渲染成人看的表格；自检脚本读的是同一份。
L.push('## 〇、从哪儿装（换机器部署必读）');
L.push('');
L.push('本机跑通了不代表另一台也能跑。缺东西时按这张表补，命令行自检会把对应链接直接打出来。');
L.push('');
L.push('### 基础环境');
L.push('');
L.push('| 项目 | 版本 | 渠道 | 说明 |');
L.push('| --- | --- | --- | --- |');
const runtimeRows = [
  ['Node.js', '20+', sources.runtime?.node],
  ['pnpm', '9+', sources.runtime?.pnpm],
  ['ComfyUI', 'Windows 整合包（推荐）', sources.runtime?.comfyuiPortable],
  ['Python', '3.12（整合包内置）', sources.runtime?.python],
];
for (const [label, version, entry] of runtimeRows) {
  if (!entry) continue;
  L.push(`| ${label} | ${version} | ${entry.url} | ${entry.note ?? ''} |`);
}
L.push('');
L.push('### 大模型整包');
L.push('');
L.push('逐个下 30 个文件很折腾，能整包拿优先整包：');
L.push('');
L.push('| 渠道 | 地址 | 提取码 | 覆盖 |');
L.push('| --- | --- | --- | --- |');
for (const bundle of sources.bundles ?? []) {
  L.push(
    `| ${bundle.name} | ${bundle.url || '（无公开地址）'} | ${bundle.code ?? '—'} | ${bundle.covers ?? '—'} |`
  );
}
L.push('');
L.push('> 国内环境优先 ModelScope，直连速度快。HuggingFace 需要代理或镜像站。');
L.push('');
L.push('### 按显存选模型版本');
L.push('');
L.push('同一份工作流常有多个量化版。模板里写死了文件名，换版本要同步改 JSON 或做软链接。');
L.push('');
L.push('| 显存 | 视频主模型 | 文本编码器 | 分辨率上限 |');
L.push('| --- | --- | --- | --- |');
L.push('| 8–12 GB | `minimax_h3_fl2va_pruned_w4a8_mixed` | `qwen3vl_8b_int8_convrot` | 480P |');
L.push('| 16 GB | `minimax_h3_ref2va_pruned_int8_convrot` | `qwen3vl_32b_minimax_h3_int8_convrot` | 720P |');
L.push('| 20–24 GB | `Minimax-h3_Singularity_ref2va_v1.3_int8` | `qwen3vl_32b_minimax_h3_int8_convrot` | 720P（1080P 顶边界） |');
L.push('| 40 GB+ | 同上 | `qwen3vl_32b_minimax_h3_nvfp4_awq` | 1080P |');
L.push('');
L.push('> `nvfp4` 需要 40 系及以上显卡，30 系只能用 int8。');
L.push('');
L.push('### 命令行自检');
L.push('');
L.push('```bash');
L.push('node scripts/check-environment.mjs          # 缺什么连带下载地址一起打印');
L.push('node scripts/check-environment.mjs --json   # 机器读');
L.push('node scripts/fetch-models.mjs --write       # 生成带路径的清单');
L.push('```');
L.push('');
L.push('服务控制台的「环境自检」面板里，失败项下面也会列出渠道；');
L.push('旁边的「依赖清单」按钮直接打开本文件。');
L.push('');
L.push('---');
L.push('');

L.push('## 一、需要安装的 ComfyUI 自定义节点包');
L.push('');
L.push('把下面这些目录从旧机器的 `ComfyUI/custom_nodes/` 整个拷到新机器同名目录。');
L.push('');
L.push('| 节点包目录 | 提供的节点类 |');
L.push('| --- | --- |');
for (const [pkg, classes] of [...byPackage.entries()].sort()) {
  if (pkg.startsWith('(')) continue;
  L.push(`| \`${pkg}\` | ${[...classes].sort().map((c) => `\`${c}\``).join(', ')} |`);
}
L.push('');

const extras = [...byPackage.entries()].filter(([p]) => p.startsWith('('));
if (extras.length) {
  L.push('### 随 ComfyUI 自带（无需单独安装）');
  L.push('');
  for (const [pkg, classes] of extras) {
    L.push(`- ${pkg}：${[...classes].sort().map((c) => `\`${c}\``).join(', ')}`);
  }
  L.push('');
}

if (missing.length) {
  L.push('### ⚠ 未能在当前 ComfyUI 中找到的节点类');
  L.push('');
  L.push('这些类被模板引用，但 `/object_info` 里没有对应模块 —— 说明当前环境本身就缺，');
  L.push('对应模板在本机也是不可用状态。');
  L.push('');
  for (const c of missing) L.push(`- \`${c}\`（${nodeUsage.get(c).size} 个模板在用）`);
  L.push('');
}

L.push('## 二、需要存在的模型 / 资源文件');
L.push('');
L.push(
  '`文件名` 是模板里写死的值，必须在新机器上放在 ComfyUI 对应目录下（相对路径要一致）。' +
    '「实际路径」来自本机 `COMFY_DIR` 的真实扫描，找不到的会标 `未安装`。'
);
L.push('');
L.push('| 文件名 | 模板数 | 实际路径（相对 ComfyUI 根） | 大小 |');
L.push('| --- | --- | --- | --- |');

/**
 * 在本机的 ComfyUI 目录里找文件的真实位置。
 *
 * 以前这张表是拿文件名猜目录（`/vae/` 猜 VAE、`/lora/` 猜 LORAS），猜错了
 * 迁移时会照着错的路径放文件。改成真扫一遍：找到就用实际相对路径，
 * 找不到就明确写「未安装」，不猜。
 */
const indexModels = () => {
  const modelsRoot = join(COMFY_DIR, 'models');
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
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = relative(COMFY_DIR, full).split(sep).join('/');
        const size = statSync(full).size;
        // 同一文件名可能在多个位置，保留先找到的那个
        if (!map.has(entry.name)) map.set(entry.name, { rel, size });
      }
    }
  };
  walk(modelsRoot);
  return map;
};

const modelIndex = indexModels();
const humanSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

for (const [f, t] of [...fileUsage.entries()].sort()) {
  // 模板里可能带子目录（Foo/bar.safetensors），索引按文件名建
  const base = f.split(/[\\/]/).pop();
  const hit = modelIndex.get(base);
  const where = hit ? `\`${hit.rel}\`` : '**未安装**';
  L.push(`| \`${f}\` | ${t.size} | ${where} | ${hit ? humanSize(hit.size) : '—'} |`);
}
L.push('');

L.push('## 三、按模板拆分');
L.push('');
for (const t of byTemplate) {
  const custom = [...t.classes].filter((c) => !CORE_NODES.has(c)).sort();
  const pkgs = [...new Set(custom.map((c) => packageOf(moduleOf.get(c))).filter(Boolean))].sort();
  L.push(`### ${t.name}`);
  L.push('');
  L.push(`- 节点 ${t.classes.size} 个（自定义 ${custom.length}）`);
  if (pkgs.length) L.push(`- 依赖节点包：${pkgs.map((p) => `\`${p}\``).join('、')}`);
  if (t.files.size) L.push(`- 资源文件：${[...t.files].map((f) => `\`${f}\``).join('、')}`);
  L.push('');
}

writeFileSync(OUT, L.join('\n') + '\n', 'utf8');

// 机器可读版本：打包 / 迁移脚本读这份，别再把文件清单硬编码进脚本 ——
// 模板新增 AICG3D 节点那轮，硬编码清单就漏了 5 个模型。
const JSON_OUT = OUT.replace(/\.md$/, '.json');
writeFileSync(
  JSON_OUT,
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      templateCount: templates.length,
      customNodeClasses: customClasses,
      missingClasses: missing,
      nodePackages: [...byPackage.entries()]
        .filter(([p]) => !p.startsWith('('))
        .map(([name, classes]) => ({ name, classes: [...classes].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      files: [...fileUsage.entries()]
        .map(([name, tpls]) => ({
          name,
          // 模板里可能带子目录（Flux\flux2-vae.safetensors），取最后一段是磁盘文件名
          basename: name.replace(/\\/g, '/').split('/').pop(),
          templates: [...tpls].sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    null,
    2
  ),
  'utf8'
);

console.log(`模板 ${templates.length} 个，自定义节点类 ${customClasses.length} 个`);
console.log('\n需要的节点包:');
for (const [pkg, classes] of [...byPackage.entries()].sort()) {
  if (pkg.startsWith('(')) continue;
  console.log(`  ${pkg}  (${classes.size} 个类)`);
}
if (missing.length) {
  console.log('\n⚠ 当前环境缺失的节点类:');
  for (const c of missing) console.log(`  ${c}`);
}
console.log(`\n已写入 ${OUT}`);

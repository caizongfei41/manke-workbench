// Map required node classes to the ComfyUI custom-node packages that provide them.
//
// ComfyUI's /object_info reports a `python_module` for every registered class, so
// the mapping comes from the running instance rather than from guessing at folder
// names. The result is the install list for a new machine: which node packages to
// copy, and which classes each one has to keep providing.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? process.cwd();
const COMFY = process.argv[3] ?? 'http://127.0.0.1:8188';
const WF_DIR = join(ROOT, 'data/comfyui/workflows');
const OUT = join(ROOT, 'docs/DEPENDENCIES.md');

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

const packageOf = (mod) => {
  if (!mod) return null;
  // "custom_nodes.ComfyUI-SeedVR2_VideoUpscaler" -> "ComfyUI-SeedVR2_VideoUpscaler"
  const m = /^custom_nodes\.([^.]+)/.exec(mod);
  if (m) return m[1];
  if (/^comfy_extras/.test(mod)) return '(comfy_extras)';
  if (/^nodes$|^comfy\./.test(mod)) return '(core)';
  return mod;
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
L.push('`文件名` 是模板里写死的值，必须在新机器上放在 ComfyUI 对应目录下（相对路径要一致）。');
L.push('');
L.push('| 文件名 | 模板数 | 推测目录 |');
L.push('| --- | --- | --- |');
const guessDir = (f) => {
  if (/\.gguf$/i.test(f)) return 'models/UNET 或 models/diffusion_models';
  if (/vae/i.test(f)) return 'models/VAE';
  if (/lora|lightning|turbo|combat/i.test(f)) return 'models/LORAS';
  if (/4x-|UltraSharp|upscale/i.test(f)) return 'models/upscale_models';
  if (/\.jpe?g$|\.png$/i.test(f)) return 'ComfyUI/input（模板示例图）';
  if (/Qwen3-TTS/i.test(f)) return 'models（TTS 权重目录）';
  return 'models/checkpoints 或 diffusion_models';
};
for (const [f, t] of [...fileUsage.entries()].sort()) {
  L.push(`| \`${f}\` | ${t.size} | ${guessDir(f)} |`);
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

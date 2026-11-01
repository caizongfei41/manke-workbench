// 生成 models 目录骨架：ComfyUI 需要的空目录。
//
// 为什么需要：ComfyUI 的 folder_paths 会在启动时注册 models/vae、models/loras
// 等路径。这些目录如果不存在，加载器就列不出任何模型 —— 用户装了模型也看不到。
//
// 02 包排除了整个 models/（模型太大，分包装），导致骨架一起没了。这里单独
// 生成一个只有空目录的小包，先于模型包解压，保证目录结构完整。
//
// 产物：build-resources/models-skeleton/（只有目录，没有文件）
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = 'E:\\ComfyUI\\ComfyUI\\models';
const OUT = 'C:/Users/Administrator/Desktop/ComfyUI无线画布/build-resources/models-skeleton';

// ComfyUI 核心加载器会注册的目录，这些必须存在
const REQUIRED = [
  'checkpoints',
  'configs',
  'loras',
  'vae',
  'vae_approx',
  'clip',
  'clip_vision',
  'text_encoders',
  'unet',
  'diffusion_models',
  'latent_upscale_models',
  'upscale_models',
  'embeddings',
  'controlnet',
  'gligen',
  'hypernetworks',
  'photomaker',
  'style_models',
  'clip_vision',
  'audio_encoders',
  'facerestore_models',
  'seedvr2',
  'depthanything',
  'diffusers',
  'model_patches',
  'TTS',
  'cosyvoice',
  'SenseVoice',
  'ultralytics',
  'insightface',
  'detection',
  'semantic_bridge',
  'background_removal',
  'frame_interpolation',
  'optical_flow',
  'geometry_estimation',
  'nsfw_detector',
  'pdd_acc',
  'reactor',
  'ReActor_nsfw',
];

console.log('  源目录 models 下的所有子目录:');
let srcDirs = [];
try {
  srcDirs = readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
} catch (e) {
  console.error('  读不到源目录: ' + e.message);
  process.exit(1);
}
console.log('    ' + srcDirs.length + ' 个');

// 合并：源目录有的 + 必需的
const all = new Set([...srcDirs, ...REQUIRED]);
console.log('  合并后需要 ' + all.size + ' 个目录');

// 检查每个目录里有没有子目录（模型可能有子分类，如 MiniMax/、Flux.2-Klein/）
const collectTree = (base, rel = '') => {
  const out = [];
  let entries;
  try {
    entries = readdirSync(path.join(base, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const childRel = rel ? path.join(rel, e.name) : e.name;
    out.push(childRel);
    out.push(...collectTree(base, childRel));
  }
  return out;
};

const allTree = new Set();
for (const d of all) {
  allTree.add(d);
  const srcPath = path.join(SRC, d);
  if (srcDirs.includes(d)) {
    for (const sub of collectTree(srcPath)) allTree.add(sub);
  }
}

console.log('  含子目录共 ' + allTree.size + ' 个');

// 生成
rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'ComfyUI', 'models'), { recursive: true });

let created = 0;
for (const rel of [...allTree].sort()) {
  const target = path.join(OUT, 'ComfyUI', 'models', rel);
  try {
    mkdirSync(target, { recursive: true });
    created += 1;
  } catch (e) {
    console.log('  XX 创建失败 ' + rel + ': ' + e.message);
  }
}

// 统计
let dirCount = 0;
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) {
      dirCount += 1;
      walk(path.join(d, e.name));
    }
  }
};
walk(OUT);

console.log('');
console.log(`  OK 生成 ${dirCount} 个目录 → ${OUT}`);
console.log('  （没有文件，只是骨架）');

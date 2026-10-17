// Static template validation against ComfyUI's live /object_info registry.
//
// Unlike POST /prompt this never enqueues work, so it is safe to run any time.
//
// Two kinds of "missing input" have to be told apart:
//   * genuinely broken templates (the node really needs a value nobody supplies)
//   * inputs the workbench adapter injects at submit time — reference images,
//     director groups, and computed sizes. Those fields are deliberately absent
//     from the stored template, so a plain required-field check reports false
//     failures. Inputs whose names appear in INJECTED_FIELDS are skipped.
import { readdirSync, readFileSync } from 'node:fs';

const TEMPLATES = 'data/comfyui/workflows';
const COMFY = process.env.BEATDESIGN_COMFYUI_URL ?? 'http://127.0.0.1:8188';

const MODEL_FIELDS = new Set([
  'unet_name', 'clip_name', 'clip_name1', 'clip_name2', 'clip_name3',
  'vae_name', 'lora_name', 'model_name', 'upscale_model_name',
  // SeedVR2 loaders name their weight field simply "model".
  'model',
]);

/** Fields the adapter supplies at submit time rather than storing them. */
const INJECTED_FIELDS = new Set([
  // reference images for Qwen multi-image editing
  'images', 'images.image_1', 'images.image_2', 'images.image_3',
  // director sub-groups (director node computes these itself)
  'bd_grp_face_detect', 'bd_grp_face_sample', 'bd_grp_face_paste',
  // EmptyLatentImage carries either explicit w/h or an aspect_ratio preset that
  // the adapter resolves; a template carrying the preset needs no explicit size.
  'aspect_ratio', 'megapixels', 'multiple',
]);

const oi = await fetch(`${COMFY}/object_info`, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json());

function optionsFor(classType, field) {
  const def = oi[classType];
  if (!def) return null;
  for (const bucket of [def.input?.required, def.input?.optional]) {
    const spec = bucket?.[field];
    if (!Array.isArray(spec)) continue;
    const first = spec[0];
    if (Array.isArray(first)) return first.map(String);
    if (first === 'COMBO') return (spec[1]?.options ?? []).map(String);
  }
  return null;
}

const files = readdirSync(TEMPLATES).filter((f) => f.endsWith('.json'));
const results = [];

for (const file of files) {
  const doc = JSON.parse(readFileSync(`${TEMPLATES}/${file}`, 'utf8'));
  const missingNodes = [];
  const missingInputs = [];
  const badModels = [];
  const emptyModelLists = [];
  const emptyValues = [];
  const unloadableModels = [];

  for (const [id, node] of Object.entries(doc)) {
    if (id.startsWith('_') || !node || typeof node !== 'object') continue;

    if (!oi[node.class_type]) { missingNodes.push(`${id}: "${node.class_type}"`); continue; }

    const required = Object.keys(oi[node.class_type]?.input?.required ?? {});
    for (const field of required) {
      if (node.inputs?.[field] !== undefined) continue;
      if (INJECTED_FIELDS.has(field)) continue;
      // A preset that stands in for individual fields.
      if (required.some((f) => INJECTED_FIELDS.has(f))) continue;
      missingInputs.push(`${id} (${node.class_type}).${field}`);
    }

    for (const [field, value] of Object.entries(node.inputs ?? {})) {
      if (!MODEL_FIELDS.has(field)) continue;
      const options = optionsFor(node.class_type, field);
      if (options === null) continue;
      // A registered node with an empty model list means its model folder has
      // no files: every submission will fail on the same missing weight.
      if (options.length === 0) { emptyModelLists.push(`${id} (${node.class_type}).${field}`); continue; }
      if (typeof value !== 'string' || !value) {
        // The template left the weight unset, which would submit an invalid value.
        emptyValues.push(`${id} (${node.class_type}).${field} is empty`);
        continue;
      }
      // The prompt-conditioned "PE-" Qwen GGUF builds validate but cannot be
      // loaded: ComfyUI reports "Could not detect model type of: ...". Flag them
      // here rather than waiting for a failed run.
      if (/-pe-(t2i|i2v)/i.test(value)) {
        unloadableModels.push(`${id} (${node.class_type}).${field} = "${value}" (PE- GGUF build is not loadable)`);
        continue;
      }
      const want = value.replace(/\\/g, '/');
      if (!options.some((o) => o.replace(/\\/g, '/') === want)) {
        badModels.push(`${id} (${node.class_type}).${field} = "${value}"`);
      }
    }
  }

  results.push({ file, missingNodes, missingInputs, badModels, emptyModelLists, emptyValues, unloadableModels });
}

const broken = [];
let clean = 0;
for (const r of results) {
  // An unregistered node is fatal: ComfyUI rejects the whole prompt. Missing
  // optional-looking inputs and model names are reported but not fatal.
  const fatal = r.missingNodes.length > 0;
  const quiet = !r.missingInputs.length && !r.badModels.length
    && !r.emptyModelLists.length && !r.emptyValues.length && !r.unloadableModels.length;
  if (!fatal && quiet) clean++;
  else broken.push({ ...r, fatal });
}

console.log(`${clean}/${files.length} templates are clean.\n`);
for (const r of broken) {
  console.log(`${r.fatal ? 'BROKEN' : 'WARN  '}  ${r.file}`);
  for (const m of r.missingNodes) console.log(`         unregistered node  ${m}`);
  for (const m of r.missingInputs) console.log(`         missing input     ${m}`);
  for (const m of r.badModels) console.log(`         unknown model     ${m}`);
  for (const m of r.emptyModelLists) console.log(`         no models on disk ${m}`);
  for (const m of r.emptyValues) console.log(`         unset model field ${m}`);
  for (const m of r.unloadableModels) console.log(`         unloadable model  ${m}`);
}

const fatalCount = broken.filter((b) => b.fatal).length;
console.log(`\n${fatalCount} template(s) cannot be submitted on this machine (unregistered node).`);
console.log(`${broken.length - fatalCount} template(s) have warnings only.`);
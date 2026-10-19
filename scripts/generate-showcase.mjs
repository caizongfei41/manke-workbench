// 用本机 ComfyUI 生成首页展示图：一批不同风格的高质量作品
//
//   node scripts/generate-showcase.mjs            全部生成
//   node scripts/generate-showcase.mjs --only=2   只生成第 2 个
//
// 结果写进项目「首页展示」，这样它们像正常素材一样出现在素材库与首页。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const WORKFLOW = join(ROOT, 'data/comfyui/workflows/小枫-qwen-image-2-1-文生图.json');
const OUT_DIR = join(ROOT, '.verify/showcase');
const PROJECT_NAME = '首页展示';
const H = { 'x-beatapi-workspace-request': '1', origin: APP };

/**
 * Eight looks, chosen so a rotation through them reads as range rather than repetition:
 * a face, a landscape, a product, architecture, a night street, film nostalgia, macro,
 * and something abstract. Prompts lead with medium and light, because that is what
 * separates the styles; adjectives alone produce the same picture eight times.
 */
const STYLES = [
  {
    name: 'cinematic-portrait',
    prompt:
      'cinematic film still, close portrait of a woman in a wet silk coat standing in a rain-soaked alley at night, neon signs out of focus behind her, 35mm anamorphic, shallow depth of field, warm skin tones against cold blue light, fine film grain, photorealistic',
  },
  {
    name: 'ink-landscape',
    prompt:
      'traditional Chinese ink wash painting, layered mountain ridges in mist, a single pine on a cliff, vast empty space, soft grey gradients, one faint vermilion seal, rice paper texture, minimal and quiet',
  },
  {
    name: 'product-still',
    prompt:
      'luxury perfume bottle on wet black stone, single hard rim light from the right, deep shadow, water droplets, seamless dark background, commercial product photography, razor sharp reflections, 100mm macro',
  },
  {
    name: 'architecture',
    prompt:
      'brutalist concrete staircase seen from below, hard afternoon sunlight cutting sharp geometric shadows, pale sky, minimal composition, architectural photography, fine concrete texture, high contrast',
  },
  {
    name: 'neon-street',
    prompt:
      'cyberpunk night market street in the rain, stacked holographic signage in cyan and magenta, wet asphalt mirroring the lights, a lone figure with an umbrella, wide angle, atmospheric haze, cinematic color grade',
  },
  {
    name: 'film-nostalgia',
    prompt:
      '1970s American road trip photograph, vintage convertible on an empty desert highway at golden hour, dust in the air, faded Kodachrome colors, heavy grain, sun flare, nostalgic and warm',
  },
  {
    name: 'macro-nature',
    prompt:
      'extreme macro of morning dew on a spider web between grass blades, backlit by sunrise, bokeh circles, iridescent highlights, ultra fine detail, shallow focus, natural greens and gold',
  },
  {
    name: 'abstract-liquid',
    prompt:
      'iridescent liquid metal swirling on a black surface, oil-slick rainbow reflections, high gloss, studio lighting, abstract fine art photography, ultra detailed, dark and luminous',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const comfyPost = async (path, body) => {
  const response = await fetch(`${COMFY}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
  return response.json();
};

const ensureProject = async () => {
  const list = await (await fetch(`${APP}/api/app/projects`, { headers: H })).json();
  const existing = (list.projects ?? []).find((project) => project.name === PROJECT_NAME);
  if (existing) return existing.id;
  const created = await (
    await fetch(`${APP}/api/app/projects`, {
      method: 'POST',
      headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ name: PROJECT_NAME, workspaceMode: 'studio' }),
    })
  ).json();
  return created.id;
};

const uploadToProject = async (projectId, bytes, filename) => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename);
  form.append('assetClass', 'original');
  const response = await fetch(`${APP}/api/app/projects/${projectId}/assets`, {
    method: 'POST',
    headers: H,
    body: form,
  });
  if (!response.ok) throw new Error(`upload → ${response.status} ${await response.text()}`);
  return (await response.json()).asset;
};

const generateOne = async ({ style, projectId, index }) => {
  const raw = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
  const workflow = Object.fromEntries(
    Object.entries(raw).filter(([, node]) => node && typeof node === 'object' && 'class_type' in node)
  );
  workflow['4'].inputs.text = style.prompt;
  workflow['7'].inputs.seed = Math.floor(Math.random() * 1e15);
  workflow['11'].inputs.aspect_ratio = '16:9 (Widescreen)';
  workflow['11'].inputs.megapixels = 2;
  workflow['24'].inputs.filename_prefix = `showcase_${style.name}`;

  const queued = await comfyPost('/prompt', { prompt: workflow, client_id: `showcase-${index}` });
  const promptId = queued.prompt_id;
  process.stdout.write(`  ${style.name.padEnd(20)} 已提交 ${promptId.slice(0, 8)} `);

  const started = Date.now();
  for (;;) {
    await sleep(3000);
    const history = await (await fetch(`${COMFY}/history/${promptId}`)).json();
    const entry = history[promptId];
    if (!entry) {
      if (Date.now() - started > 15 * 60 * 1000) throw new Error('超时');
      continue;
    }
    const outputs = entry.outputs ?? {};
    const images = Object.values(outputs).flatMap((node) => node.images ?? []);
    if (!images.length) throw new Error('没有产出图片');

    const image = images[0];
    const view = await fetch(
      `${COMFY}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(
        image.subfolder ?? ''
      )}&type=${image.type ?? 'output'}`
    );
    const bytes = Buffer.from(await view.arrayBuffer());
    const asset = await uploadToProject(projectId, bytes, `${style.name}.png`);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`→ 完成 ${seconds}s  ${Math.round(bytes.length / 1024)}KB`);
    return asset;
  }
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];
  const chosen = only ? STYLES.filter((_, index) => String(index + 1) === only) : STYLES;

  const health = await fetch(`${COMFY}/system_stats`).then((r) => r.json()).catch(() => null);
  if (!health) {
    console.log('  ComfyUI 不可达');
    process.exit(1);
  }

  const projectId = await ensureProject();
  console.log(`  项目 ${PROJECT_NAME} (${projectId.slice(0, 8)})，共 ${chosen.length} 张`);

  const made = [];
  for (const [index, style] of chosen.entries()) {
    try {
      const asset = await generateOne({ style, projectId, index });
      made.push({ style: style.name, assetId: asset?.id });
    } catch (error) {
      console.log(`  ${style.name} 失败：${String(error).slice(0, 120)}`);
    }
    // 单张之间放一点显存回收的时间
    await comfyPost('/free', { unload_models: false, free_memory: true }).catch(() => {});
  }

  writeFileSync(join(OUT_DIR, 'generated.json'), JSON.stringify(made, null, 2) + '\n', 'utf8');
  console.log(`  完成 ${made.length} / ${chosen.length}`);
};

await main();

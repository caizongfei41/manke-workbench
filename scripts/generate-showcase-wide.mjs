// 首页轮播：9 张宽幅高质图，风格互不重复
//
//   node scripts/generate-showcase-wide.mjs --only=1   先生一张看看
//   node scripts/generate-showcase-wide.mjs            全部九张
//
// 舞台是 16:7 的宽幅，所以生成比例按宽幅走，避免 UI 里再裁掉构图。
// 结果写进「首页展示」项目，和原来的素材一样是普通文件。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const WORKFLOW = join(ROOT, 'data/comfyui/workflows/小枫-qwen-image-2-1-文生图.json');
const OUT_DIR = join(ROOT, '.verify/showcase-wide');
const PROJECT_NAME = '首页展示';
const H = { 'x-beatapi-workspace-request': '1', origin: APP };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const only = (() => {
  const arg = process.argv.find((value) => value.startsWith('--only='));
  return arg ? Number(arg.split('=')[1]) : null;
})();

/**
 * 九种气质，各占一个方向：冷调建筑、暖调自然、暗调静物、霓虹街景、
 * 极简留白、金属质感、雾中森林、抽象流体、沙漠黄昏。
 * 每条都写明光线与构图，模型对这种描述最稳。
 */
const STYLES = [
  {
    name: 'brutalist-light',
    prompt:
      'Brutalist concrete architecture photographed at harsh midday, deep geometric shadows cutting across pale grey planes, wide cinematic composition, ultra sharp detail, architectural photography, 8k',
  },
  {
    name: 'mist-forest',
    prompt:
      'Layered pine forest fading into dawn mist, cool blue-green tones, a narrow path leading into fog, wide cinematic composition, volumetric light rays, landscape photography, 8k',
  },
  {
    name: 'crystal-still',
    prompt:
      'Crystal glass object on wet black stone, single hard rim light from the left, deep black background, macro product photography, razor sharp facets, wide cinematic crop, 8k',
  },
  {
    name: 'neon-rain',
    prompt:
      'Neon-lit street at night in heavy rain, magenta and cyan signs reflected on wet asphalt, shallow depth of field, wide cinematic composition, cyberpunk photography, 8k',
  },
  {
    name: 'desert-dusk',
    prompt:
      'Endless desert dunes at dusk, warm amber light raking across rippled sand, long shadows, minimalist wide composition, large sky, landscape photography, 8k',
  },
  {
    name: 'ink-water',
    prompt:
      'Black ink blooming through clear water against a pure white background, curling filaments suspended mid-motion, wide panoramic crop, high speed macro photography, 8k',
  },
  {
    name: 'steel-macro',
    prompt:
      'Machined titanium surface at an extreme angle, brushed metal grain catching cold blue light, shallow focus falloff, wide cinematic composition, industrial product photography, 8k',
  },
  {
    name: 'fractal-flow',
    prompt:
      'Iridescent liquid swirl of oil and pigment on water, rainbow interference patterns, black background, wide panoramic composition, macro photography, extremely fine detail, 8k',
  },
  {
    name: 'quiet-interior',
    prompt:
      'Minimal interior at golden hour, warm sunlight across a bare plaster wall and a single wooden bench, long shadows, wide cinematic composition, architectural photography, 8k',
  },
  {
    name: 'aurora-lake',
    prompt:
      'Arctic lake at night with green aurora borealis rippling overhead, black mountains mirrored in still water, wide panoramic composition, astro landscape photography, 8k',
  },
  {
    name: 'autumn-road',
    prompt:
      'Forest road in autumn, tunnel of red and gold foliage, soft overcast light, wet leaves on asphalt, wide cinematic composition, landscape photography, 8k',
  },
  {
    name: 'marble-vein',
    prompt:
      'Extreme macro of white marble veined with thin gold fissures, raking light across the polished surface, minimal wide crop, fine art photography, 8k',
  },
  {
    name: 'oil-rainbow',
    prompt:
      'Thin film of oil on wet asphalt creating rainbow interference, shallow focus band across the frame, urban macro photography, wide cinematic composition, 8k',
  },
  {
    name: 'snow-ridge',
    prompt:
      'Snow-covered mountain ridge at blue hour, wind sculpting spindrift off the crest, cold minimal sky, wide panoramic composition, alpine photography, 8k',
  },
  {
    name: 'copper-dust',
    prompt:
      'Sculpted copper powder disturbed by a puff of air, warm metallic dust suspended against deep shadow, high speed macro, wide cinematic crop, 8k',
  },
  {
    name: 'paper-fold',
    prompt:
      'Giant white paper folded into sharp origami planes in a bright studio, hard directional light casting crisp geometric shadows, minimal wide composition, still life photography, 8k',
  },
  {
    name: 'tide-pool',
    prompt:
      'Tide pool at low tide with layered turquoise water, sand ripples and scattered shells, sunlight refracting in the shallows, wide cinematic composition, nature photography, 8k',
  },
  {
    name: 'city-rain-lights',
    prompt:
      'Long exposure of city traffic at night, streaks of red and white light through a rain-soaked intersection, wide cinematic composition, urban photography, 8k',
  },
  {
    name: 'silk-shadow',
    prompt:
      'Flowing black silk caught mid-motion against a warm off-white backdrop, single soft light revealing folds and sheen, wide cinematic composition, fashion still life, 8k',
  },
  {
    name: 'model-studio-portrait',
    prompt:
      'Editorial studio portrait of a young woman, soft beauty dish from the front, deep grey seamless background, sharp catchlights in her eyes, natural skin texture, wide cinematic crop, high fashion photography, 8k',
  },
  {
    name: 'model-window-light',
    prompt:
      'Portrait of a man in profile by a tall window, hard afternoon sunlight striping across his face, dark interior, wide cinematic composition, film photography, 8k',
  },
  {
    name: 'model-street-night',
    prompt:
      'Street portrait at night under neon signage, subject lit by a magenta rim light, shallow depth of field with bokeh city behind, wide cinematic composition, editorial photography, 8k',
  },
  {
    name: 'model-golden-hour',
    prompt:
      'Backlit portrait at golden hour, warm rim light through hair, soft field behind, natural expression, wide cinematic composition, outdoor portrait photography, 8k',
  },
  {
    name: 'model-monochrome',
    prompt:
      'Black and white studio portrait, high contrast single hard light, dramatic shadow across half the face, plain dark backdrop, wide cinematic crop, fine art portrait photography, 8k',
  },
  {
    name: 'model-wind-coast',
    prompt:
      'Portrait of a woman on a windy coast, hair blown across her face, overcast diffused light, muted blue-grey sea behind, wide cinematic composition, editorial photography, 8k',
  },
  {
    name: 'model-studio-color',
    prompt:
      'Fashion portrait in a coloured studio, saturated teal backdrop, sharp hard key light with a crisp shadow onto the wall, bold styling, wide cinematic composition, editorial photography, 8k',
  },
  {
    name: 'model-rain-glass',
    prompt:
      'Portrait seen through rain-streaked glass, face softly in focus behind the droplets, cool blue tones, wide cinematic composition, cinematic portrait photography, 8k',
  },
  {
    name: 'model-soft-smoke',
    prompt:
      'Portrait in drifting smoke, single warm side light carving out the silhouette, dark background, wide cinematic composition, moody editorial photography, 8k',
  },
  {
    name: 'model-daylight-close',
    prompt:
      'Tight beauty portrait in flat daylight, minimal makeup, fine skin detail and individual lashes visible, neutral background, wide cinematic crop, commercial beauty photography, 8k',
  },
];

const comfyPost = async (path, body) => {
  const response = await fetch(`${COMFY}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
  return response.json();
};

const findProject = async () => {
  const response = await fetch(`${APP}/api/app/projects`, { headers: H });
  const payload = await response.json();
  const found = (payload.projects ?? []).find((project) => project.name === PROJECT_NAME);
  if (!found) throw new Error(`找不到项目 ${PROJECT_NAME}`);
  return found.id;
};

const upload = async (projectId, bytes, filename) => {
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
  // 宽幅：舞台是 16:7，用 21:9 出图再裁两侧，比 16:9 更接近最终构图
  workflow['11'].inputs.aspect_ratio = '21:9 (Ultrawide)';
  workflow['11'].inputs.megapixels = 2.5;
  workflow['24'].inputs.filename_prefix = `wide_${style.name}`;

  const queued = await comfyPost('/prompt', { prompt: workflow, client_id: `wide-${index}` });
  const promptId = queued.prompt_id;
  process.stdout.write(`  ${style.name.padEnd(18)} 已提交 ${promptId.slice(0, 8)} `);

  const started = Date.now();
  for (;;) {
    await sleep(3000);
    const history = await (await fetch(`${COMFY}/history/${promptId}`)).json();
    const entry = history[promptId];
    if (!entry) {
      if (Date.now() - started > 20 * 60 * 1000) throw new Error('超时');
      continue;
    }
    const images = Object.values(entry.outputs ?? {}).flatMap((node) => node.images ?? []);
    if (!images.length) throw new Error('没有产出图片');

    const image = images[0];
    const view = await fetch(
      `${COMFY}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(
        image.subfolder ?? ''
      )}&type=${image.type ?? 'output'}`
    );
    const bytes = Buffer.from(await view.arrayBuffer());
    const filename = `${style.name}.png`;
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, filename), bytes);
    const asset = await upload(projectId, bytes, filename);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`→ 完成 ${seconds}s  ${Math.round(bytes.length / 1024)}KB  ${asset.id.slice(0, 8)}`);
    return asset;
  }
};

const main = async () => {
  const projectId = await findProject();
  const picks = only ? [STYLES[only - 1]].filter(Boolean) : STYLES;
  console.log(`  项目 ${PROJECT_NAME}，共 ${picks.length} 张，宽幅 21:9`);
  let done = 0;
  for (const [index, style] of picks.entries()) {
    try {
      await generateOne({ style, projectId, index: only ?? index });
      done += 1;
    } catch (error) {
      console.log(`  ${style.name} 失败: ${String(error).slice(0, 120)}`);
    }
  }
  console.log(`  完成 ${done} / ${picks.length}`);
  process.exit(done === picks.length ? 0 : 1);
};

await main();

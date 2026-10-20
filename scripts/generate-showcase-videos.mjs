// 生成首页展示视频：几段不同风格的高质量片段
//
//   node scripts/generate-showcase-videos.mjs --only=1   先出一段试水
//   node scripts/generate-showcase-videos.mjs           全部
//
// 用的是本机的 H3 长视频工作流（低显存版本）。结果写进「首页展示」项目，
// 和图片一样是普通素材。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const WORKFLOW = join(ROOT, 'data/comfyui/workflows/小枫-aicg3d-h3-低显存长视频.json');
const OUT_DIR = join(ROOT, '.verify/showcase-videos');
const PROJECT_NAME = '首页展示';
const H = { 'x-beatapi-workspace-request': '1', origin: APP };

/**
 * 四段片子，题材与光线各走一个方向：夜景雨街、沙漠黄昏、室内静物、山林晨雾。
 * 提示词沿用工作流的结构（镜头 / 时间轴 / 环境声 / 配乐），因为这套模型的
 * 解析器认这个形状，换成人话反而会掉质量。
 */
const STYLES = [
  {
    name: 'neon-rain',
    shot: 'Neon-lit street at night in the rain, wet asphalt mirroring magenta and cyan signs, a lone figure with a transparent umbrella walking towards camera, anamorphic flare, shallow depth of field.',
    beat: 'the figure walks slowly forward, rain streaks catch the light, reflections ripple across the pavement',
    sound: 'steady rain on pavement, distant traffic',
    music: 'low synth pulse',
  },
  {
    name: 'desert-dusk',
    shot: 'Wide desert highway at dusk, a vintage convertible parked at the shoulder, dust hanging in warm backlight, mountains in silhouette, golden hour colour grade.',
    beat: 'heat shimmer rises off the asphalt, the camera pushes in slowly, dust drifts through the frame',
    sound: 'dry wind over sand, faint engine tick',
    music: 'warm slide guitar',
  },
  {
    name: 'studio-still',
    shot: 'Macro studio shot of a crystal perfume bottle on wet black stone, single hard rim light from the right, deep shadow, water droplets, product photography.',
    beat: 'the camera arcs slowly around the bottle, highlights sweep across the glass facets',
    sound: 'quiet room tone',
    music: 'minimal ambient pad',
  },
  {
    name: 'forest-mist',
    shot: 'Misty mountain forest at dawn, layered pine silhouettes fading into fog, a narrow path with wet stones, cool blue-green palette, soft volumetric light.',
    beat: 'mist drifts between the trees, the camera glides forward along the path',
    sound: 'birds at distance, dripping water',
    music: 'sparse piano',
  },
  {
    name: 'concrete-shadow',
    shot: 'Brutalist concrete stairwell at harsh midday sun, deep geometric shadows cutting across pale walls',
    beat: 'the camera tilts up along the stairs, shadow edges slide across the concrete',
    sound: 'dry echo in an empty stairwell',
    music: 'staccato strings',
  },
  {
    name: 'ink-water',
    shot: 'Macro shot of black ink blooming through clear water against a white background, curling filaments of colour',
    beat: 'ink plumes spread and fold slowly, the camera holds still',
    sound: 'muffled underwater tone',
    music: 'single sustained cello',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry a request a few times: the server drops connections while staging models. */
const withRetry = async (label, run, attempts = 8) => {
  let last;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (index < attempts - 1) await sleep(4000);
    }
  }
  throw new Error(`${label} 失败：${String(last).slice(0, 120)}`);
};

const promptFor = (style) =>
  [
    `integrated_multimodal_description: [Shot 1] ${style.shot}`,
    `0.0-4.0s: ${style.beat}`,
    `overall_soundscape: ${style.sound}`,
    `non_diegetic_music: ${style.music}`,
  ].join('\n');

const loadWorkflow = () => {
  const raw = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
  return Object.fromEntries(
    Object.entries(raw).filter(([, node]) => node && typeof node === 'object' && 'class_type' in node)
  );
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

const uploadToProject = async (projectId, bytes, filename, mimeType) => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), filename);
  form.append('assetClass', 'original');
  const response = await fetch(`${APP}/api/app/projects/${projectId}/assets`, {
    method: 'POST',
    headers: H,
    body: form,
  });
  if (!response.ok) throw new Error(`upload → ${response.status} ${await response.text()}`);
  return (await response.json()).asset;
};

const generateOne = async ({ style, projectId }) => {
  const workflow = loadWorkflow();
  const prompt = promptFor(style);
  for (const id of ['107', '108', '109']) {
    if (workflow[id]) {
      workflow[id].inputs.prompt = prompt;
      workflow[id].inputs.seed = Math.floor(Math.random() * 1e6);
    }
  }
  workflow['60'].inputs.filename_prefix = `video/showcase_${style.name}`;

  const queued = await (
    await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `showcase-video-${style.name}` }),
    })
  ).json();
  if (!queued.prompt_id) throw new Error(JSON.stringify(queued).slice(0, 200));

  const promptId = queued.prompt_id;
  process.stdout.write(`  ${style.name.padEnd(16)} 已提交 ${promptId.slice(0, 8)} `);
  const started = Date.now();

  for (;;) {
    await sleep(5000);
    const history = await withRetry('poll', async () => (await fetch(`${COMFY}/history/${promptId}`)).json());
    const entry = history[promptId];
    if (!entry) {
      if (Date.now() - started > 45 * 60 * 1000) throw new Error('超时');
      continue;
    }
    const outputs = entry.outputs ?? {};
    const files = Object.values(outputs).flatMap((node) => [
      ...(node.images ?? []),
      ...(node.videos ?? []),
      ...(node.gifs ?? []),
    ]);
    const video = files.find((file) => /mp4|webm|mov/i.test(file.filename ?? ''));
    if (!video) throw new Error('没有产出视频');

    const bytes = await withRetry('download', async () => {
      const view = await fetch(
        `${COMFY}/view?filename=${encodeURIComponent(video.filename)}&subfolder=${encodeURIComponent(
          video.subfolder ?? ''
        )}&type=${video.type ?? 'output'}`
      );
      if (!view.ok) throw new Error(String(view.status));
      return Buffer.from(await view.arrayBuffer());
    });
    const asset = await uploadToProject(projectId, bytes, `${style.name}.mp4`, 'video/mp4');
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`→ 完成 ${seconds}s  ${Math.round(bytes.length / 1024 / 1024)}MB`);
    return asset;
  }
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];
  const chosen = only ? STYLES.filter((_, index) => String(index + 1) === only) : STYLES;

  const health = await fetch(`${COMFY}/system_stats`).then((response) => response.json()).catch(() => null);
  if (!health) {
    console.log('  ComfyUI 不可达');
    process.exit(1);
  }

  const projectId = await ensureProject();
  console.log(`  项目 ${PROJECT_NAME}，共 ${chosen.length} 段`);

  const made = [];
  for (const style of chosen) {
    try {
      const asset = await generateOne({ style, projectId });
      made.push({ style: style.name, assetId: asset?.id, url: asset?.publicUrl });
    } catch (error) {
      console.log(`  ${style.name} 失败：${String(error).slice(0, 160)}`);
    }
  }

  writeFileSync(join(OUT_DIR, 'generated.json'), JSON.stringify(made, null, 2) + '\n', 'utf8');
  console.log(`  完成 ${made.length} / ${chosen.length}`);
};

await main();

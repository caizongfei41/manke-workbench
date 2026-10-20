// 首页展示：三段人物视频，重点是镜头语言
//
//   node scripts/generate-showcase-portraits.mjs --only=1   先出一段
//   node scripts/generate-showcase-portraits.mjs            三段全部
//
// 这三段替换首页「生成出来的片子」下面一行。它们存在的理由是证明这台机器能拍出
// 有拍摄意图的镜头，所以提示词严格按工作流的结构写：镜头描述 / 时间轴 / 环境声 / 配乐，
// 并把景别、景深、运镜、机位写进第一句——这套模型的解析器认这个形状。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const WORKFLOW = join(ROOT, 'data/comfyui/workflows/小枫-aicg3d-h3-低显存长视频.json');
const OUT_DIR = join(ROOT, '.verify/showcase-portraits');
const PROJECT_NAME = '首页展示';
const H = { 'x-beatapi-workspace-request': '1', origin: APP };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const only = (() => {
  const arg = process.argv.find((value) => value.startsWith('--only='));
  return arg ? Number(arg.split('=')[1]) : null;
})();

/**
 * 三种完全不同的机位语言，都用亚洲面孔：
 *
 * 1. 浅景深特写 + 缓慢推轨 —— 证明能控景深与焦点
 * 2. 低角度跟拍 + 手持有呼吸感 —— 证明能控机位高度与运动
 * 3. 环绕运镜 + 逆光轮廓 —— 证明能控旋转与光位
 */
const STYLES = [
  {
    name: 'portrait-shallow-track',
    shot:
      'Asian woman in her late twenties, close-up at eye level, 85mm telephoto with very shallow depth of field, background city lights dissolved into soft bokeh circles, key light from a window on camera left, fine skin texture and individual lashes visible',
    beat:
      'the camera dollies in slowly over four seconds while her eyes lift to meet the lens, focus holds on her face as the bokeh drifts behind her',
    sound: 'quiet room tone, a distant traffic hum',
    music: 'single sustained piano note',
  },
  {
    name: 'portrait-low-angle-walk',
    shot:
      'Asian man in a dark coat walking toward camera, low angle from waist height looking up, 35mm wide lens, wet night street with neon signage bokeh behind him, rim light along his shoulders',
    beat:
      'handheld camera tracks backward matching his pace, slight frame breathing, his coat swings and rain glints on the pavement',
    sound: 'footsteps on wet concrete, rain, distant traffic',
    music: 'low pulsing synth',
  },
  {
    name: 'portrait-orbit-backlight',
    shot:
      'Asian woman standing in a doorway at golden hour, medium shot, 50mm lens, strong backlight creating a glowing rim around her hair and shoulders, interior falling into deep shadow, dust motes visible in the light beam',
    beat:
      'the camera arcs slowly around her from left to right, her head turns to follow the light, the rim light widens across her face as the angle changes',
    sound: 'birds outside, a faint wind',
    music: 'warm strings entering late',
  },
];

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

const uploadToProject = async (projectId, bytes, filename) => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), filename);
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
  workflow['60'].inputs.filename_prefix = `video/portrait_${style.name}`;

  const queued = await (
    await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `showcase-portrait-${style.name}` }),
    })
  ).json();
  if (!queued.prompt_id) throw new Error(`submit → ${JSON.stringify(queued).slice(0, 200)}`);
  process.stdout.write(`  ${style.name.padEnd(24)} 已提交 ${queued.prompt_id.slice(0, 8)} `);

  const started = Date.now();
  for (;;) {
    await sleep(4000);
    const history = await (await fetch(`${COMFY}/history/${queued.prompt_id}`)).json();
    const entry = history[queued.prompt_id];
    if (!entry) {
      if (Date.now() - started > 25 * 60 * 1000) throw new Error('超时');
      continue;
    }
    const outputs = entry.outputs ?? {};
    const found = Object.values(outputs)
      .flat()
      .map((node) => node?.gifs?.[0] ?? node?.videos?.[0] ?? node?.images?.find((i) => /\.mp4$/i.test(i.filename)))
      .find(Boolean);
    if (!found) throw new Error('没有产出视频');

    const view = await fetch(
      `${COMFY}/view?filename=${encodeURIComponent(found.filename)}&subfolder=${encodeURIComponent(
        found.subfolder ?? ''
      )}&type=${found.type ?? 'output'}`
    );
    const bytes = Buffer.from(await view.arrayBuffer());
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${style.name}.mp4`), bytes);
    const asset = await uploadToProject(projectId, bytes, `${style.name}.mp4`);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`→ 完成 ${seconds}s ${(bytes.length / 1024 / 1024).toFixed(1)}MB ${asset.id.slice(0, 8)}`);
    return asset;
  }
};

const main = async () => {
  const projectId = await ensureProject();
  const picks = only ? [STYLES[only - 1]].filter(Boolean) : STYLES;
  console.log(`  项目 ${PROJECT_NAME}，共 ${picks.length} 段`);
  let done = 0;
  for (const [index, style] of picks.entries()) {
    try {
      await generateOne({ style, projectId, index: only ?? index });
      done += 1;
    } catch (error) {
      console.log(`  ${style.name} 失败: ${String(error).slice(0, 140)}`);
    }
  }
  console.log(`  完成 ${done} / ${picks.length}`);
  process.exit(done === picks.length ? 0 : 1);
};

await main();

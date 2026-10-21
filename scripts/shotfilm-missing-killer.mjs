// 《消失的凶手》全片生成
//
//   node scripts/shotfilm-missing-killer.mjs --act=1     生成第一幕
//   node scripts/shotfilm-missing-killer.mjs --act=all   全片 25 段
//   node scripts/shotfilm-missing-killer.mjs --only=7    单段重做
//
// 每一段按导演台工作流的语法写：镜头描述 / 时间轴 / 环境声 / 配乐。
// 这段话不是散文——模型从这个结构里读景别、焦段、机位、运镜。
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const WORKFLOW = join(
  ROOT,
  process.env.MK_WORKFLOW ?? 'data/comfyui/workflows/小枫-无限分段生视频-api.json'
);
const OUT_DIR = join(ROOT, '.verify/missing-killer');
const PROJECT_NAME = '消失的凶手';
const H = { 'x-beatapi-workspace-request': '1', origin: APP };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 全片统一视觉基调：南方雨季，冷绿灰，一切都在潮气里。 */
// The model parses this shape, not prose. Every extra token is sampled: 55k tokens took 21
// minutes, 90k took over 30. Keep the look to what actually changes the frame.
const LOOK = 'cinematic low-key, cool green-grey, rainy, 35mm grain, shallow DOF';

const CAST = {
  zhou: 'Zhou Yan, 34, lean Chinese detective, dark trench coat, scarred left ring finger',
  lin: 'Lin He, 28, Chinese woman, short black bob, beige knit sweater, old wristwatch',
  chen: 'Chen Mo, 41, heavy-set Chinese man, wire-rimmed glasses, checked shirt',
  body: 'a man in his thirties lying face down on a wooden floor, dark red stain spreading under his chest',
};

const SHOTS = [
  // 第一幕 · 密室
  {
    n: 1,
    act: 1,
    shot:
      'extreme wide shot, 35mm lens, rain-soaked exterior of a four-storey South Chinese apartment building at night, one window on the fourth floor glowing warm through wet glass, slow horizontal dolly left to right along the street, rain streaks visible in the light of a sodium streetlamp',
    beat:
      '0.0-4.0s the camera drifts past darkened windows, the single lit window holds at frame right; the rain never stops',
    sound: 'heavy rain on concrete, distant traffic, a shutter rattling',
    music: 'low sustained cello drone',
  },
  {
    n: 2,
    act: 1,
    shot:
      `${CAST.chen} standing in a narrow dim corridor, medium shot 50mm, handheld with slight breathing, facing away from camera at a closed wooden door, a single bare bulb above him, peeling green paint on the walls`,
    beat:
      '0.0-4.0s he knocks twice and waits, his shoulders rise with a held breath, the bare bulb flickers once',
    sound: 'knuckles on wood, rain muffled through walls, a cistern dripping',
    music: 'single low piano note repeating',
  },
  {
    n: 3,
    act: 1,
    shot:
      'extreme close-up, 85mm lens wide open, only a man\u2019s ear and the gap under a wooden door in frame, shallow focus on the ear, warm light leaking beneath the door',
    beat:
      '0.0-4.0s he leans closer, his ear almost touches the door, then goes still; nothing moves in the gap of light',
    sound: 'absolute silence under the rain, then his breathing',
    music: 'the piano stops',
  },
  {
    n: 4,
    act: 1,
    shot:
      'point of view walking through an open door into an apartment, 24mm wide lens, slow push in, ${CAST.body}, a toppled chair, an open laptop still glowing, a glass of water on the desk',
    beat:
      '0.0-4.0s the camera enters low and slow, tilting down to the body, the laptop screen flickers and dies',
    sound: 'a door hinge, footsteps stopping, rain on the window',
    music: 'a single dissonant string swell',
  },
  {
    n: 5,
    act: 1,
    shot: `${CAST.zhou} crouching beside the body, top-down overhead shot 50mm directly above him, harsh ceiling light, water pooled on the floorboards reflecting the bulb`,
    beat:
      '0.0-4.0s he touches the wet floor with two fingers and looks up at the window, no expression change',
    sound: 'fabric shifting, water dripping into a puddle',
    music: 'silence',
  },
  {
    n: 6,
    act: 1,
    shot:
      'the locked room, 35mm lens on a slow 90-degree arc around the space, window with an intact latch on the inside, no balcony, no other exit, rain running down the glass',
    beat:
      '0.0-4.0s the camera orbits past the window, the desk, the body, and returns to the door; every exit is shut from the inside',
    sound: 'rain, a clock ticking somewhere',
    music: 'a held high note',
  },

  // 第二幕 · 三个时间
  {
    n: 7,
    act: 2,
    shot: `${CAST.lin} sitting in a police station corridor, medium close-up 85mm shallow focus, side-lit by a fluorescent tube, holding a cigarette she has not lit`,
    beat:
      '0.0-4.0s her hand trembles, she brings the cigarette to her lips and lowers it again without lighting it',
    sound: 'a fluorescent hum, a distant door closing',
    music: 'a sparse repeated piano figure',
  },
  {
    n: 8,
    act: 2,
    shot:
      'extreme macro close-up 100mm, an old woman\u2019s wristwatch on a woman\u2019s wrist, worn leather strap, its inner side carrying a faint engraved date',
    beat:
      '0.0-4.0s her fingers turn the strap over, revealing the engraving, and hold there',
    sound: 'the strap creaking, her breath',
    music: 'the piano figure stops',
  },
  {
    n: 9,
    act: 2,
    shot: `${CAST.zhou} over-the-shoulder from behind him, 50mm, focus racked onto the watch on her wrist, his face soft in the foreground`,
    beat:
      '0.0-4.0s his gaze drops to the strap; the focus settles sharp on the watch and stays',
    sound: 'a chair creaking, silence',
    music: 'a low pulse begins',
  },
  {
    n: 10,
    act: 2,
    shot:
      'flashback, warm soft light unlike the present, 85mm slow motion, ${CAST.lin} in a bedroom at dusk taking off a watch and setting it on a dresser, her reflection in a dark window',
    beat:
      '0.0-4.0s she unclasps the watch and places it down; the reflection does not quite match her movement',
    sound: 'a clasp opening, a clock in the room',
    music: 'warm strings, slightly out of tune',
  },
  {
    n: 11,
    act: 2,
    shot: `${CAST.chen} smoking in the stairwell, medium shot 35mm, strong backlight from a window behind him, smoke curling into the light, his face half in shadow`,
    beat:
      '0.0-4.0s he exhales, glances up the stairs, then back at the detective off-frame',
    sound: 'a cigarette burning, rain beyond the window',
    music: 'silence',
  },
  {
    n: 12,
    act: 2,
    shot: `extreme close-up 85mm on ${CAST.chen}\u2019s eyes behind wire-rimmed glasses, the lens catching the window light, everything else falling away`,
    beat:
      '0.0-4.0s he says the time and blinks once, his eyes sliding away from the lens at the last word',
    sound: 'his voice, then only rain',
    music: 'the low pulse returns, faster',
  },
  {
    n: 13,
    act: 2,
    shot: `${CAST.zhou} extreme close-up 100mm, the camera completely still, a faint reflection of the corridor bulb in his right eye`,
    beat:
      '0.0-4.0s nothing moves; he does not blink for the whole beat, and the frame holds on his stillness',
    sound: 'rain only',
    music: 'one sustained note, no resolution',
  },

  // 第三幕 · 水管
  {
    n: 14,
    act: 3,
    shot: `${CAST.zhou} standing alone in the corridor, medium shot 35mm from a low angle looking up, ceiling pipes running overhead, the bare bulb behind him`,
    beat:
      '0.0-4.0s he tilts his head slightly, listening, then looks straight up at the ceiling',
    sound: 'a faint mechanical hum beginning somewhere in the building',
    music: 'silence',
  },
  {
    n: 15,
    act: 3,
    shot:
      'macro close-up on a corroded water pipe joint, water droplets trembling on the metal, then the pipe visibly shuddering',
    beat:
      '0.0-4.0s the vibration builds, a droplet falls, then the whole pipe shakes once',
    sound: 'a pressure pump kicking in, pipes hammering through the walls',
    music: 'a rhythmic industrial pulse',
  },
  {
    n: 16,
    act: 3,
    shot: `${CAST.zhou} from directly below, 24mm wide lens tilted up, the corridor ceiling and pipes looming above him, strong forced perspective`,
    beat:
      '0.0-4.0s the pipes rattle overhead; he does not move, his face lit from below by the bulb',
    sound: 'the pump running, water rushing in the walls',
    music: 'the pulse continues',
  },
  {
    n: 17,
    act: 3,
    shot: `${CAST.zhou} walking along the corridor toward a balcony door, tracking shot 35mm at waist height following behind him`,
    beat:
      '0.0-4.0s the camera follows him through the corridor, his coat moving, then stops as he stops at the balcony door',
    sound: 'footsteps, rain getting louder',
    music: 'the pulse slows',
  },
  {
    n: 18,
    act: 3,
    shot:
      'overhead wide shot looking down on two adjacent balconies separated by a narrow gap, heavy rain falling between them, four floors up',
    beat:
      '0.0-4.0s the camera holds above the gap; the distance between the two railings is almost nothing',
    sound: 'rain hammering metal railings',
    music: 'silence',
  },
  {
    n: 19,
    act: 3,
    shot:
      'extreme close-up macro on a balcony railing, fresh scrape marks in the paint, wet rust, a fibre caught on a rough edge',
    beat:
      '0.0-4.0s the focus slides along the railing and finds the scrape, holding on it as rain runs through',
    sound: 'rain on metal, close and loud',
    music: 'a single struck string',
  },
  {
    n: 20,
    act: 3,
    shot:
      'low angle close on a pair of men\u2019s leather shoes just inside an apartment door, mud dried on the soles, a cheap patterned carpet beneath them',
    beat:
      '0.0-4.0s the shoes shift slightly, then the camera tilts up a few centimetres and holds',
    sound: 'a footstep, a breath',
    music: 'the pulse returns',
  },

  // 第四幕 · 拆穿
  {
    n: 21,
    act: 4,
    shot: `${CAST.zhou} and ${CAST.lin} across a metal interrogation table, 50mm two-shot, cold overhead light, the watch placed between them`,
    beat:
      '0.0-4.0s he pushes the watch across the table; she looks at it and does not reach for it',
    sound: 'metal on metal, a ventilation hum',
    music: 'silence',
  },
  {
    n: 22,
    act: 4,
    shot: `${CAST.lin} close-up 85mm, tears standing in her eyes but not falling, her jaw tight`,
    beat:
      '0.0-4.0s she says it, her eyes drop to the table, and the tear finally moves',
    sound: 'her voice breaking, a chair scraping',
    music: 'a low sustained tone',
  },
  {
    n: 23,
    act: 4,
    shot: `${CAST.zhou} over-the-shoulder toward ${CAST.chen}, 85mm with a very slow push in on Chen\u2019s face`,
    beat:
      '0.0-4.0s the camera creeps forward while Zhou speaks; Chen\u2019s glasses catch the light and hide his eyes',
    sound: 'Zhou\u2019s voice, quiet and level',
    music: 'the pulse, slowing to nothing',
  },
  {
    n: 24,
    act: 4,
    shot: `${CAST.chen} extreme close-up, harsh top light that dims slowly across the shot until only the rim of his face remains`,
    beat:
      '0.0-4.0s he does not answer; the light drains from his face and the frame goes almost dark',
    sound: 'silence, then a single drop of water',
    music: 'nothing',
  },
  {
    n: 25,
    act: 4,
    shot: `${CAST.zhou} from behind, wide shot 35mm, walking out of the apartment building\u2019s entrance into a street where the rain has just stopped, wet asphalt reflecting streetlights`,
    beat:
      '0.0-4.0s he walks away from camera; the camera stays and slowly pulls back until he is small in the frame',
    sound: 'dripping gutters, a distant siren',
    music: 'the cello drone from the first shot returns and resolves',
  },
];

const promptFor = (shot) =>
  [
    `${LOOK}. [Shot ${shot.n}] ${shot.shot}`,
    shot.beat,
    `sound: ${shot.sound}`,
    `music: ${shot.music}`,
  ].join('\n');

/** ComfyUI 在任务结束后还要卸载模型；这时提交会被拒，等它真的空下来。 */
const waitForIdle = async () => {
  for (let i = 0; i < 120; i += 1) {
    const q = await (await fetch(`${COMFY}/queue`)).json();
    if (q.queue_running.length === 0 && q.queue_pending.length === 0) return;
    await sleep(3000);
  }
};

/** 这个工作流带了 40 个分段节点，只用第 1 个，其余删掉以免重复渲染。 */
const SEGMENT_NODES = ['107', '108', '109', '110', '113'];

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
      body: JSON.stringify({ name: PROJECT_NAME, workspaceMode: 'canvas', canvasKind: 'drama' }),
    })
  ).json();
  return created.id;
};

const upload = async (projectId, bytes, filename, mime) => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  form.append('assetClass', 'original');
  const response = await fetch(`${APP}/api/app/projects/${projectId}/assets`, {
    method: 'POST',
    headers: H,
    body: form,
  });
  if (!response.ok) throw new Error(`upload ${response.status}`);
  return (await response.json()).asset;
};

const generateShot = async ({ shot, projectId }) => {
  await waitForIdle();
  const workflow = loadWorkflow();
  const prompt = promptFor(shot);

  // 这个工作流自带 40 个分段节点，整片只用一个分段节点跑单镜。
  // 其余段落不连到合成链，留着会被一起执行 —— 删掉更省时间。
  for (const id of Object.keys(workflow)) {
    if (workflow[id].class_type === 'AICG3D_H3SequenceSegment' && id !== '107') delete workflow[id];
  }
  if (workflow['107']) {
    workflow['107'].inputs.prompt = prompt;
    workflow['107'].inputs.seed = 1000 + shot.n * 37;
    workflow['107'].inputs.seconds = 12;
  }
  // 合成节点直接接第 1 段
  if (workflow['60']) {
    workflow['60'].inputs.final_segment = ['107', 0];
    workflow['60'].inputs.filename_prefix = `video/mk_shot${String(shot.n).padStart(2, '0')}`;
  }

  const queued = await (
    await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `mk-${shot.n}` }),
    })
  ).json();
  if (!queued.prompt_id) {
    const detail = queued.error?.message ?? JSON.stringify(queued).slice(0, 300);
    throw new Error(`ComfyUI 拒收: ${String(detail).slice(0, 200)}`);
  }
  process.stdout.write(`  第 ${String(shot.n).padStart(2, '0')} 段 提交 ${queued.prompt_id.slice(0, 8)} `);

  const started = Date.now();
  for (;;) {
    await sleep(5000);
    const history = await (await fetch(`${COMFY}/history/${queued.prompt_id}`)).json();
    const entry = history[queued.prompt_id];
    if (!entry) {
      if (Date.now() - started > 30 * 60 * 1000) throw new Error('超时');
      continue;
    }
    // The combine node reports its file under `images`, not `videos` — a .mp4 filename
    // in an images array. Reading only gifs/videos is why every shot looked like it
    // produced nothing.
    const found = Object.values(entry.outputs ?? {})
      .flatMap((node) => [
        ...(node?.gifs ?? []),
        ...(node?.videos ?? []),
        ...(node?.images ?? []).filter((item) => /\.(mp4|webm|mov)$/i.test(item.filename ?? '')),
      ])
      .find((item) => item?.filename);
    if (!found) throw new Error('没有产出');

    const view = await fetch(
      `${COMFY}/view?filename=${encodeURIComponent(found.filename)}&subfolder=${encodeURIComponent(
        found.subfolder ?? ''
      )}&type=${found.type ?? 'output'}`
    );
    const bytes = Buffer.from(await view.arrayBuffer());
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `shot${String(shot.n).padStart(2, '0')}.mp4`), bytes);
    await upload(projectId, bytes, `shot${String(shot.n).padStart(2, '0')}.mp4`, 'video/mp4');
    console.log(`→ ${Math.round((Date.now() - started) / 1000)}s ${(bytes.length / 1024 / 1024).toFixed(1)}MB`);
    writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify({ shots: SHOTS.map((s) => s.n) }, null, 2));
    return true;
  }
};

const main = async () => {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const actArg = process.argv.find((a) => a.startsWith('--act='));
  const picks = onlyArg
    ? [SHOTS.find((s) => s.n === Number(onlyArg.split('=')[1]))].filter(Boolean)
    : actArg && actArg !== '--act=all'
      ? SHOTS.filter((s) => s.act === Number(actArg.split('=')[1]))
      : SHOTS;

  const projectId = await ensureProject();
  console.log(`  项目「${PROJECT_NAME}」共 ${picks.length} 段`);
  let done = 0;
  for (const shot of picks) {
    const existing = join(OUT_DIR, `shot${String(shot.n).padStart(2, '0')}.mp4`);
    if (!process.argv.includes('--force') && existsSync(existing)) {
      console.log(`  第 ${String(shot.n).padStart(2, '0')} 段 已在，跳过`);
      done += 1;
      continue;
    }
    try {
      await generateShot({ shot, projectId });
      done += 1;
    } catch (error) {
      console.log(`  第 ${shot.n} 段失败: ${String(error).slice(0, 130)}`);
      await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
    }
  }
  console.log(`  完成 ${done} / ${picks.length}`);
  process.exit(done === picks.length ? 0 : 1);
};

await main();

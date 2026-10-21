// 《消失的凶手》对白配音
//
//   node scripts/shotfilm-missing-killer-voice.mjs
//
// 用 Qwen3-TTS 的三合一工作流，一次跑一条对白。每个角色一个音色，
// instruct 里写情绪和语气——这个模型的 instruct 是自然语言，写得越具体越准。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';
const WORKFLOW = join(ROOT, 'data/comfyui/workflows/小枫-qwen3-tts-三合一整合版.json');
const OUT_DIR = join(ROOT, '.verify/missing-killer/voice');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 音色分配：
 *   周砚 — 低沉、克制、语速慢。台词少，每一句都像结论。
 *   林鹤 — 压抑的年轻女声，随时要哭但忍住。
 *   陈默 — 圆滑、话多、急于解释，笑着说话。
 */
const VOICES = {
  zhou: { speaker: 'Ono_Anna', instruct: '低沉平稳的男声，语速慢，几乎没有起伏，像在陈述结论，压着情绪' },
  lin: { speaker: 'Serena', instruct: '年轻女声，声音发颤，压抑着哭腔，语速偏快，像急着解释' },
  chen: { speaker: 'Ethan', instruct: '中年男声，圆滑，略带笑意，语速快，急于辩解' },
};

const LINES = [
  { id: 'v01', who: 'chen', text: '高老师？高老师你在吗？我是对门老陈。' },
  { id: 'v02', who: 'zhou', text: '门是从里面锁的。窗户也是。' },
  { id: 'v03', who: 'zhou', text: '你最后一次见他，是几点。' },
  { id: 'v04', who: 'lin', text: '九点……不对，八点五十。我走的时候他还好好的。' },
  { id: 'v05', who: 'zhou', text: '你戴着这块表？' },
  { id: 'v06', who: 'lin', text: '一直戴着。他送我的。' },
  { id: 'v07', who: 'chen', text: '我九点多听见他们吵架，吵得挺凶的。我怕出事，才报的警。' },
  { id: 'v08', who: 'zhou', text: '九点多。' },
  { id: 'v09', who: 'zhou', text: '这栋楼的水泵，每天八点四十五准时启动。' },
  { id: 'v10', who: 'zhou', text: '泵一响，整栋楼什么都听不见。你在九点多，听见了什么？' },
  { id: 'v11', who: 'lin', text: '表……我换了表。八点二十五，我怕你们算时间。' },
  { id: 'v12', who: 'zhou', text: '他八点四十就死了。你八点半走的时候，他还活着。' },
  { id: 'v13', who: 'zhou', text: '两个阳台，隔着六十公分。' },
  { id: 'v14', who: 'zhou', text: '你鞋底的泥，是四楼阳台的。' },
  { id: 'v15', who: 'chen', text: '……我只是想让他把钱还我。' },
];

const load = () => {
  const raw = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
  return Object.fromEntries(
    Object.entries(raw).filter(([, node]) => node && typeof node === 'object' && 'class_type' in node)
  );
};

const speak = async (line) => {
  const workflow = load();
  const voice = VOICES[line.who];
  // 只用一个 TTS 节点：20 号负责输出，30 号删掉避免重复生成
  if (workflow['20']) {
    workflow['20'].inputs.text = line.text;
    workflow['20'].inputs.speaker = voice.speaker;
    workflow['20'].inputs.instruct = voice.instruct;
    workflow['20'].inputs.seed = Math.floor(Math.random() * 1e6);
    workflow['20'].inputs.language = 'Chinese';
  }
  if (workflow['101']) {
    workflow['101'].inputs.filename_prefix = `audio/mk_${line.id}`;
  }
  delete workflow['30'];
  delete workflow['102'];

  const queued = await (
    await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `mk-voice-${line.id}` }),
    })
  ).json();
  if (!queued.prompt_id) throw new Error(`submit ${JSON.stringify(queued).slice(0, 160)}`);
  process.stdout.write(`  ${line.id} ${line.who} `);

  const started = Date.now();
  for (;;) {
    await sleep(2500);
    const history = await (await fetch(`${COMFY}/history/${queued.prompt_id}`)).json();
    const entry = history[queued.prompt_id];
    if (!entry) {
      if (Date.now() - started > 8 * 60 * 1000) throw new Error('超时');
      continue;
    }
    const audio = Object.values(entry.outputs ?? {})
      .flat()
      .map((node) => node?.audio?.[0] ?? node?.audio)
      .flat()
      .find((a) => a?.filename);
    if (!audio) throw new Error('没有产出音频');

    const view = await fetch(
      `${COMFY}/view?filename=${encodeURIComponent(audio.filename)}&subfolder=${encodeURIComponent(
        audio.subfolder ?? ''
      )}&type=${audio.type ?? 'output'}`
    );
    const bytes = Buffer.from(await view.arrayBuffer());
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${line.id}.mp3`), bytes);
    console.log(`→ ${Math.round((Date.now() - started) / 1000)}s ${(bytes.length / 1024).toFixed(0)}KB`);
    return true;
  }
};

const main = async () => {
  console.log(`  共 ${LINES.length} 条对白`);
  let done = 0;
  for (const line of LINES) {
    try {
      await speak(line);
      done += 1;
    } catch (error) {
      console.log(`  ${line.id} 失败: ${String(error).slice(0, 120)}`);
      await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
    }
  }
  writeFileSync(join(OUT_DIR, 'lines.json'), JSON.stringify(LINES, null, 2));
  console.log(`  完成 ${done} / ${LINES.length}`);
};

await main();

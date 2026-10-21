// 《消失的凶手》主题曲
//
//   node scripts/shotfilm-missing-killer-music.mjs
//
// 一首片尾曲。风格定成悬疑片尾那种——不是悲伤，是「事情结束了但没过去」。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';
const WORKFLOW = join(ROOT, 'data/comfyui/workflows/小枫-yue2-歌曲创作.json');
const OUT_DIR = join(ROOT, '.verify/missing-killer/music');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 歌词写的是案子结束后的事：凶手带走了，可雨还在下。
const LYRICS = `### 《雨停了，人还没走》

[Intro]

[Verse]
四楼的灯 亮了又灭
有人敲门 没人应声
水管在墙里 准时地响
把每句话 都吞进管道

[Verse]
你说你听见 那晚的争吵
可那时整栋楼 什么都听不见
我数过时间 也数过谎
它们对不上

[Pre-Chorus]
不是所有的门 都从外面锁
不是所有的话 都说给人听

[Chorus]
雨停了 街上还有水
人走了 影子还留在这里
我把你的名字 写进案卷
再合上 就当没认识过你

[Chorus]
雨停了 谁都别提
那扇窗 那晚 谁开过
我只是个 数时间的人
数到最后 剩下自己

[Outro]`;

const STYLE = {
  配方: '自定义 / Custom',
  演唱语言: '中文 / Chinese',
  音乐风格: '华语流行 / Mandopop',
  风格融合: '另类摇滚 / Alternative Rock',
  人声编制: '女声独唱 / Female Lead',
  人声音色: '沙哑 / Husky',
  人声唱法: '流行通俗 / Pop Vocal',
  人声效果: '冷混响 / Cold Reverb',
  速度: '中慢 76-95 / Mid-Slow 76-95 BPM',
  BPM数值: 78,
  情绪氛围: '忧郁感伤 / Melancholic',
  主奏乐器: '钢琴 / Piano',
  辅助乐器: '大提琴 / Cello',
  编曲密度: '稀疏 / Sparse',
  制作质感: '跟随风格 / Follow Style',
  音乐特征: '悬疑片尾曲，克制，不煽情，留白多',
  自定义补充: 'cold rainy night, unresolved tension, sparse arrangement with long silences',
};

const main = async () => {
  const raw = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
  const workflow = Object.fromEntries(
    Object.entries(raw).filter(([, n]) => n && typeof n === 'object' && 'class_type' in n)
  );

  if (workflow['41']) workflow['41'].inputs.lyrics_text = LYRICS;
  if (workflow['43']) {
    Object.assign(workflow['43'].inputs, STYLE);
    workflow['43'].inputs.seed = 20261021;
    workflow['43'].inputs.max_duration = 300;
  }

  const queued = await (
    await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'mk-music' }),
    })
  ).json();
  if (!queued.prompt_id) throw new Error(JSON.stringify(queued).slice(0, 200));
  console.log(`  提交 ${queued.prompt_id.slice(0, 8)}`);

  const started = Date.now();
  for (;;) {
    await sleep(8000);
    const history = await (await fetch(`${COMFY}/history/${queued.prompt_id}`)).json();
    const entry = history[queued.prompt_id];
    if (!entry) {
      if (Date.now() - started > 60 * 60 * 1000) throw new Error('超时');
      continue;
    }
    const audio = Object.values(entry.outputs ?? {})
      .flat()
      .map((node) => node?.audio?.[0] ?? node?.audio ?? node?.gifs?.[0])
      .flat()
      .find((a) => a?.filename);
    if (!audio) throw new Error('没有产出');
    const view = await fetch(
      `${COMFY}/view?filename=${encodeURIComponent(audio.filename)}&subfolder=${encodeURIComponent(
        audio.subfolder ?? ''
      )}&type=${audio.type ?? 'output'}`
    );
    const bytes = Buffer.from(await view.arrayBuffer());
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, audio.filename), bytes);
    writeFileSync(join(OUT_DIR, 'lyrics.md'), LYRICS, 'utf8');
    console.log(`  完成 ${Math.round((Date.now() - started) / 1000)}s ${(bytes.length / 1024 / 1024).toFixed(1)}MB`);
    return;
  }
};

await main();

// 自动排版：列对齐、按实测高度等距、可撤销
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;

const tabs = await (await fetch(`${CDP}/json`)).json();
for (const extra of tabs.filter((t) => t.type === 'page' && /3020/.test(t.url)).slice(1)) {
  await fetch(`${CDP}/json/close/${extra.id}`).catch(() => {});
}
const tab = tabs.find((t) => t.type === 'page' && /3020/.test(t.url));
if (!tab) { console.log('没有页面'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});

let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const text = String(m.params.exceptionDetails?.exception?.description ?? '');
    if (!/Project not found/.test(text)) errors.push(text.slice(0, 160));
  }
});
const send = (method, params = {}) => {
  const n = ++seq;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((res, rej) => {
    pending.set(n, { resolve: res, reject: rej });
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 60000);
  });
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name + (detail ? '  ' + detail : '')); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '排版验证', workspaceMode: 'canvas' }) })).json();

// 三段高度差很大：短、长、短。乱放的初始位置
const shots = [
  { id: 's1', index: 0, title: '第 1 段', prompt: '短提示词。', seconds: 3 },
  { id: 's2', index: 1, title: '第 2 段', prompt: '长提示词。'.repeat(40), seconds: 4 },
  { id: 's3', index: 2, title: '第 3 段', prompt: '另一个短提示词。', seconds: 5 },
].map((s) => ({ ...s, publicAssetIds: [], ownImageUrls: [], videoUrl: null, versions: [], status: 'idle' }));

const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {
          // 故意摆乱：同列不齐、间距不均、最终台偏上
          script: { x: 12, y: 260 }, board: { x: 300, y: 20 },
          assets: { x: 640, y: 500 }, params: { x: 590, y: 60 },
          s1: { x: 900, y: 600 }, s2: { x: 950, y: 120 }, s3: { x: 880, y: 940 },
          final: { x: 1200, y: 40 },
        },
        links: [],
        params: {}, loras: [], subtitles: true, exportPreset: 'vertical',
        enhance: { enabled: false, rules: [], extra: '' },
        bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [], shots, finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (await ev("document.querySelectorAll('svg path[marker-end]').length > 0")) break;
  await delay(500);
}

// 读每个节点的内容坐标与尺寸
const layout = () => ev(`(() => {
  const out = {};
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')];
  for (const head of heads) {
    // 取标题元素本身：textContent 会把副标题（3s · 待生成）拼进来，变成「13s」
    const title = (head.querySelector('span.truncate')?.textContent || '').trim();
    let el = head.parentElement;
    while (el && getComputedStyle(el).position !== 'absolute') el = el.parentElement;
    if (!el) continue;
    const key = /剧本/.test(title) ? 'script'
      : /分镜台/.test(title) ? 'board'
      : /公共资产图/.test(title) ? 'assets'
      : /生成参数台/.test(title) ? 'params'
      : /最终视频台/.test(title) ? 'final'
      : /分段工作台 (\\d+)/.exec(title)?.[1] === '1' ? 's1'
      : /分段工作台 (\\d+)/.exec(title)?.[1] === '2' ? 's2'
      : /分段工作台 (\\d+)/.exec(title)?.[1] === '3' ? 's3' : null;
    if (!key) continue;
    out[key] = {
      x: parseInt(el.style.left || '0', 10),
      y: parseInt(el.style.top || '0', 10),
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
  }
  return out;
})()`);

const before = await layout();
check('五个阶段 + 三个分段都在', Object.keys(before ?? {}).length === 8, String(Object.keys(before ?? {}).length));

const buttonExists = await ev(`[...document.querySelectorAll('button')].some(b => (b.textContent||'').trim() === '自动排版')`);
check('工具条有自动排版', buttonExists === true);

await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '自动排版'); b?.click(); })()`);
await delay(1200);
const after = await layout();

// 列对齐：同列 x 一致
check('剧本/分镜台/资产/分段/最终各占一列',
  new Set([after.script.x, after.board.x, after.assets.x, after.params.x, after.s1.x, after.s2.x, after.s3.x, after.final.x]).size === 5,
  JSON.stringify([after.script.x, after.board.x, after.assets.x, after.params.x, after.s1.x, after.final.x]));

check('资产与参数台同列', after.assets.x === after.params.x, `${after.assets.x} / ${after.params.x}`);
check('三个分段同列', after.s1.x === after.s2.x && after.s2.x === after.s3.x, `${after.s1.x}/${after.s2.x}/${after.s3.x}`);
check('列从左到右递增',
  after.script.x < after.board.x && after.board.x < after.assets.x && after.assets.x < after.s1.x && after.s1.x < after.final.x,
  `${after.script.x} < ${after.board.x} < ${after.assets.x} < ${after.s1.x} < ${after.final.x}`);

// 等距：间距 = 实测高度 + 32
const gap1 = after.s2.y - (after.s1.y + after.s1.h);
const gap2 = after.s3.y - (after.s2.y + after.s2.h);
check('分段之间间距相等（按各自高度）', gap1 === gap2, `${gap1} / ${gap2}`);
check('间距是 32', gap1 === 32 && gap2 === 32, `${gap1} / ${gap2}`);

// 不重叠
check('分段之间没有重叠', gap1 > 0 && gap2 > 0);

// 参数台在资产下方且不压住
check('参数台在资产图下面', after.params.y >= after.assets.y + after.assets.h, `${after.params.y} vs ${after.assets.y + after.assets.h}`);

// 最终台大致居中于分段列
const stackMid = (after.s1.y + after.s3.y + after.s3.h) / 2;
const finalMid = after.final.y + after.final.h / 2;
check('最终台对齐分段列中线', Math.abs(stackMid - finalMid) < 40, `中线 ${Math.round(stackMid)} vs ${Math.round(finalMid)}`);

// 排版结果要落进快照，刷新后不回弹
await delay(2200);
const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(saved.document?.drama ?? '{}');
const savedPos = drama.positions ?? {};
check('排版写进快照', savedPos.s1?.x === 880 && savedPos.s1?.y === 40, JSON.stringify(savedPos.s1 ?? null));
check('参数台也在快照里', savedPos.params?.x === 580, JSON.stringify(savedPos.params ?? null));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'auto-arrange.png', Buffer.from(shot.data, 'base64'));

// 可撤销
await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
await delay(1000);
const undone = await layout();
check('自动排版可以撤销', Math.abs(undone.s1.y - after.s1.y) > 5 || Math.abs(undone.s1.x - after.s1.x) > 5,
  `s1 ${after.s1.x},${after.s1.y} → ${undone.s1.x},${undone.s1.y}`);

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

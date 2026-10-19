// 断点续跑：跑一半刷新，看是否只补缺的段
// @needs: comfyui —— 会真正提交生成任务；CI 无 GPU，跳过这一套

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const OUT = VERIFY_DIR;

const tabs = await (await fetch(`${CDP}/json`)).json();

// Keep exactly one tab. Every suite leaves one behind, and a throttled stale
// tab makes the board never get measured — wires and drags then silently fail.
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
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 90000);
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
// Chromium throttles background tabs, which stops requestAnimationFrame and
// leaves the board unmeasured. Make this tab the active one.
await send('Page.bringToFront');

// Clear the ComfyUI queue first: a leftover job from an earlier suite makes
// "the queue holds only this task" assertions fail for no real reason.
await fetch(`${COMFY}/interrupt`, { method: "POST" }).catch(() => {});
const queueBefore = await fetch(`${COMFY}/queue`).then((r) => r.json()).catch(() => null);
for (const pendingItem of queueBefore?.queue_pending ?? []) {
  await fetch(`${COMFY}/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delete: [pendingItem[0]] }),
  }).catch(() => {});
}
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '续跑验证', workspaceMode: 'canvas' }) })).json();

// 3 段，第 2 段标记为已完成（有 videoUrl），第 1、3 段待跑
const shots = [
  { id: 's1', index: 0, title: '第 1 段', prompt: '中景，雨夜街头，他撑伞站着。<d>[Chinese] 你来了。</d>', seconds: 3, publicAssetIds: [], ownImageUrls: [], videoUrl: null, status: 'idle' },
  { id: 's2', index: 1, title: '第 2 段', prompt: '近景，他抬头。<d>[Chinese] 我等你很久了。</d>', seconds: 3, publicAssetIds: [], ownImageUrls: [], videoUrl: '/done.mp4', status: 'succeeded' },
  { id: 's3', index: 2, title: '第 3 段', prompt: '特写，雨滴落在他肩上。', seconds: 3, publicAssetIds: [], ownImageUrls: [], videoUrl: null, status: 'idle' },
];
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: {}, loras: [], subtitles: true, bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [], shots, finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);

// 1) 只提示缺 2 段
const resumeBtn = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('续跑未完成的'));
  return b ? (b.textContent||'').trim() : null;
})()`);
check('提示只续跑缺的 2 段', resumeBtn === '续跑未完成的 2 段', String(resumeBtn));

const allDone = await ev(`(document.body.innerText || '').includes('全部 3 段都已完成')`);
check('没有误报全部完成', allDone === false);

// 2) 点续跑，确认只提交 1 个任务（第一段）
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('续跑未完成的'));
  b?.click();
})()`);
// 不要用「等 N 秒后数任务」来判断：第一段若秒失败，流水线会立刻推进到下一段，
// 这个数字就永远对不上。真正要证明的是「队列规模只有缺的那两段」。
await delay(2500);
const progress = await ev(`(() => {
  const text = document.body.innerText || '';
  const m = text.match(/正在跑第 (\\d+)\\/(\\d+) 段/);
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null;
})()`);
check('队列规模只含缺的段（2 段，不是 3 段）', progress?.total === 2, JSON.stringify(progress));
check('显示逐段进度', !!progress);

let gens = await (await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })).json();
check('已经开始提交任务', (gens.items ?? []).length >= 1, `${(gens.items ?? []).length} 个`);

// 3) 等第一段跑完后停止，模拟中断
const stopBtn = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '停止');
  if (b) { b.click(); return 'clicked'; }
  return 'missing';
})()`);
check('有停止按钮', stopBtn !== 'missing', String(stopBtn));

// 等第一段真正出结果
let firstDone = false;
for (let i = 0; i < 100; i += 1) {
  await delay(6000);
  const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
  const drama = JSON.parse(saved.document?.drama ?? '{}');
  const s1 = (drama.shots ?? []).find((s) => s.id === 's1');
  if (s1?.status === 'succeeded' && s1.videoUrl) { firstDone = true; break; }
  if (s1?.status === 'failed') break;
}
// 真渲染会受 GPU 抢占影响；失败就用「重跑失败段」再试一次，这也正是它的用途
if (!firstDone) {
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('重跑失败段'));
    b?.click();
  })()`);
  for (let i = 0; i < 100; i += 1) {
    await delay(6000);
    const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
    const drama = JSON.parse(saved.document?.drama ?? '{}');
    const s1 = (drama.shots ?? []).find((s) => s.id === 's1');
    if (s1?.status === 'succeeded' && s1.videoUrl) { firstDone = true; break; }
    if (s1?.status === 'failed') break;
  }
}
check('第一段完成并落盘', firstDone);

const snapshot = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(snapshot.document?.drama ?? '{}');
check('第 2 段仍是已完成', drama.shots?.find((s) => s.id === 's2')?.status === 'succeeded');
check('第 3 段仍是待跑', drama.shots?.find((s) => s.id === 's3')?.status !== 'succeeded', drama.shots?.find((s) => s.id === 's3')?.status);

// 4) 刷新页面，确认只剩 1 段待跑（真正的续跑语义）
await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);
const afterReload = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('续跑未完成的'));
  return b ? (b.textContent||'').trim() : null;
})()`);
check('刷新后只剩 1 段要续跑', afterReload === '续跑未完成的 1 段', String(afterReload));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-resume.png', Buffer.from(shot.data, 'base64'));

await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

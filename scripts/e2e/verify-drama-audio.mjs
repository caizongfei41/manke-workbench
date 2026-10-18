// 字幕开关 + BGM 选择：UI 层
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;
const FFMPEG = 'ffmpeg';

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
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '字幕混音UI', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();

// 两段带台词的分段
const shots = [
  { id: 's1', index: 0, title: '第 1 段', prompt: '中景，他走过。<d>[Chinese] 你来了。</d>', seconds: 3, publicAssetIds: [], ownImageUrls: [], videoUrl: null, status: 'idle' },
  { id: 's2', index: 1, title: '第 2 段', prompt: '近景，他抬头。<d>[Chinese] 我等你很久了。</d>', seconds: 4, publicAssetIds: [], ownImageUrls: [], videoUrl: null, status: 'idle' },
];
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

// 1) 字幕开关
const sub = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('最终视频台'));
  if (!head) return null;
  const scope = head.parentElement.parentElement;
  return {
    hasToggle: (scope.innerText || '').includes('台词烧进画面'),
    checked: scope.querySelector('input[type=checkbox]')?.checked ?? null,
    bgmLabel: (scope.innerText || '').includes('没有背景音乐'),
    hasPick: [...scope.querySelectorAll('button')].some(b => (b.textContent||'').includes('选音乐')),
  };
})()`);
check('最终台有字幕开关', sub?.hasToggle === true);
check('字幕默认开启', sub?.checked === true, String(sub?.checked));
check('显示没有背景音乐', sub?.bgmLabel === true);
check('有选音乐按钮', sub?.hasPick === true);

// 2) 关掉字幕 → 落快照
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('最终视频台'));
  const box = head.parentElement.parentElement.querySelector('input[type=checkbox]');
  box.click();
})()`);
await delay(2000);
let saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
let drama = JSON.parse(saved.document?.drama ?? '{}');
check('关掉字幕写进快照', drama.subtitles === false, String(drama.subtitles));

// 3) 上传 BGM
const wav = OUT + 'bgm-ui.wav';
await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', '-ac', '2', '-ar', '44100', wav]);
const doc = await send('DOM.getDocument', { depth: -1 });
const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file][accept="audio/*"]' });
check('找到 BGM 文件输入', !!node?.nodeId, String(node?.nodeId));
if (node?.nodeId) {
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [wav] });
  await delay(3000);
}
saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
drama = JSON.parse(saved.document?.drama ?? '{}');
check('BGM 写进快照', !!drama.bgmAssetId, String(drama.bgmAssetId ?? null));
check('BGM 文件名显示', drama.bgmName === 'bgm-ui.wav', String(drama.bgmName ?? null));

const bgmUi = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('最终视频台'));
  const scope = head.parentElement.parentElement;
  return { name: (scope.innerText||'').includes('bgm-ui.wav'), volume: !!scope.querySelector('input[type=range]') };
})()`);
check('界面显示音乐名', bgmUi?.name === true);
check('出现音量滑杆', bgmUi?.volume === true);

// 4) 清掉 BGM
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('最终视频台'));
  const scope = head.parentElement.parentElement;
  const btn = [...scope.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '×');
  btn?.click();
})()`);
await delay(2000);
saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
drama = JSON.parse(saved.document?.drama ?? '{}');
check('清掉 BGM', !drama.bgmAssetId, String(drama.bgmAssetId ?? null));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-audio.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

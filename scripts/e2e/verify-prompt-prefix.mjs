// 全局提示词前缀：存进文档、逐段原文不变、CSV 里带上、刷新后仍在
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
mkdirSync(VERIFY_DIR, { recursive: true });

const tabs = await (await fetch(`${CDP}/json`)).json();
for (const extra of tabs.filter((t) => t.type === 'page' && /:3020/.test(t.url ?? '')).slice(1)) {
  await fetch(`${CDP}/json/close/${extra.id}`).catch(() => {});
}
let tab = tabs.find((t) => t.type === 'page' && /:3020/.test(t.url ?? ''));
if (!tab) tab = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}/zh`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(String(msg.params.exceptionDetails?.exception?.description ?? '').slice(0, 160));
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description ?? '');
  return r.result.value;
};

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name + (detail ? '  ' + detail : '')); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

const dramaOf = async (projectId) => {
  const snap = await (await fetch(`${APP}/api/app/projects/${projectId}/snapshot`, { headers: { origin: APP } })).json();
  return JSON.parse(snap.document?.drama ?? '{}');
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const PREFIX = '电影感，35mm 胶片';
const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '前缀验证', workspaceMode: 'canvas' }),
})).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const shots = [0, 1].map((i) => ({
  id: `s${i + 1}`, index: i, prompt: `第 ${i + 1} 段：中景，雨夜街头。`, seconds: 3,
  publicAssetIds: [], ownImageUrls: [], videoUrl: null, versions: [], status: 'idle',
}));
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: { resolution: '480P' }, loras: [], subtitles: false, exportPreset: 'vertical',
        enhance: { enabled: false, rules: [], extra: '' },
        bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [], shots, finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
for (let i = 0; i < 40; i += 1) {
  await delay(800);
  if (await ev("!!document.querySelector('[data-prompt-prefix]')")) break;
}
await delay(2000);

const before = await dramaOf(proj.id);
check('初始没有前缀', (before.promptPrefix ?? '') === '', JSON.stringify(before.promptPrefix));

// 1. 输入前缀
const typed = await ev(`(() => {
  const input = document.querySelector('[data-prompt-prefix]');
  if (!input) return 'no-input';
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(PREFIX)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
check('前缀输入框可写', typed === 'ok', String(typed));

await delay(1500);
const saved = await dramaOf(proj.id);
check('前缀写进文档', saved.promptPrefix === PREFIX, JSON.stringify(saved.promptPrefix));
check('逐段原文没有被改写', JSON.stringify(saved.shots.map((s) => s.prompt)) === JSON.stringify(before.shots.map((s) => s.prompt)), JSON.stringify(saved.shots[0].prompt));

// 2. 导出的 CSV 带上前缀
const csv = await (await fetch(`${APP}/api/app/projects/${proj.id}/shotlist`, { headers: { origin: APP } })).text();
check('CSV 提示词列带上前缀', csv.includes(`${PREFIX}，第 1 段`), csv.split('\r\n')[1]?.slice(0, 60));

// 3. 刷新后仍在
await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
await delay(4000);
const reloaded = await dramaOf(proj.id);
check('刷新后前缀保留', reloaded.promptPrefix === PREFIX, JSON.stringify(reloaded.promptPrefix));

// 4. 清空前缀：原文应当恢复如初
await ev(`(() => {
  const input = document.querySelector('[data-prompt-prefix]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(1500);
const cleared = await dramaOf(proj.id);
check('清空后前缀为空', (cleared.promptPrefix ?? '') === '', JSON.stringify(cleared.promptPrefix));
check('逐段原文始终未变', JSON.stringify(cleared.shots.map((s) => s.prompt)) === JSON.stringify(before.shots.map((s) => s.prompt)), '');
const csvAfter = await (await fetch(`${APP}/api/app/projects/${proj.id}/shotlist`, { headers: { origin: APP } })).text();
check('清空后 CSV 不再带前缀', !csvAfter.includes(PREFIX), '');

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'prompt-prefix.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

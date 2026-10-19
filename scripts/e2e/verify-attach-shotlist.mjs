// 导出附带分镜表：开关默认开、关掉后入口消失、状态写进快照、刷新后保留
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

const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '附件验证', workspaceMode: 'canvas' }),
})).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
// 造一条「已有成片」的状态，这样下载入口才会渲染
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: { resolution: '480P' }, loras: [], subtitles: true, exportPreset: 'vertical',
        enhance: { enabled: false, rules: [], extra: '' },
        bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [],
        shots: [{ id: 's1', index: 0, prompt: '中景。', seconds: 3, publicAssetIds: [], ownImageUrls: [], videoUrl: '/v/1.mp4', versions: [], status: 'succeeded' }],
        finalVideoUrl: '/final.mp4', finalStatus: 'succeeded',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
for (let i = 0; i < 40; i += 1) {
  await delay(800);
  if (await ev("!!document.querySelector('[data-attach-shotlist]')")) break;
}
await delay(2000);

const checkbox = await ev(`(() => {
  const el = document.querySelector('[data-attach-shotlist]');
  return el ? { checked: el.checked } : null;
})()`);
check('开关存在且默认打开', checkbox?.checked === true, JSON.stringify(checkbox));

const linkBefore = await ev(`!!document.querySelector('[data-shotlist-download]')`);
check('默认提供分镜表下载', linkBefore === true);

const href = await ev(`document.querySelector('[data-shotlist-download]')?.getAttribute('href') ?? ''`);
check('下载指向本项目', String(href).includes(`/api/app/projects/${proj.id}/shotlist`), String(href));

// 关掉开关
await ev(`(() => {
  const el = document.querySelector('[data-attach-shotlist]');
  el?.click();
})()`);
await delay(1500);
const linkAfter = await ev(`!!document.querySelector('[data-shotlist-download]')`);
check('关掉后下载入口消失', linkAfter === false);

const saved = await dramaOf(proj.id);
check('关闭状态写进快照', saved.attachShotList === false, JSON.stringify(saved.attachShotList));

// 刷新后仍是关闭
await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
await delay(4000);
const reloaded = await ev(`(() => {
  const el = document.querySelector('[data-attach-shotlist]');
  return el ? { checked: el.checked, link: !!document.querySelector('[data-shotlist-download]') } : null;
})()`);
check('刷新后仍关闭且无下载入口', reloaded?.checked === false && reloaded?.link === false, JSON.stringify(reloaded));

// 再打开
await ev(`document.querySelector('[data-attach-shotlist]')?.click()`);
await delay(1500);
const back = await ev(`!!document.querySelector('[data-shotlist-download]')`);
check('重新打开后入口回来', back === true);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'attach-shotlist.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

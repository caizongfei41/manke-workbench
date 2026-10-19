// 分段折叠：卡片真的变矮、写进快照、刷新后仍折叠、能展开回来
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

const shotHeights = () => ev(`(() => {
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')].filter((h) => /分段工作台/.test(h.textContent || ''));
  return heads.map((head) => {
    let scope = head.parentElement;
    while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
    return Math.round(scope.getBoundingClientRect().height);
  });
})()`);


const dramaOf = async (projectId) => {
  const snap = await (await fetch(`${APP}/api/app/projects/${projectId}/snapshot`, { headers: { origin: APP } })).json();
  return JSON.parse(snap.document?.drama ?? '{}');
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// 三个分段，够验证批量折叠
const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '折叠验证', workspaceMode: 'canvas' }),
})).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const shots = [0, 1, 2].map((i) => ({
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

// 高度是布局结果，冷启动时会晚一帧：等条件成立而不是死等
const waitForHeights = async (predicate) => {
  for (let i = 0; i < 40; i += 1) {
    const heights = await shotHeights();
    if (Array.isArray(heights) && predicate(heights)) return heights;
    await delay(400);
  }
  return await shotHeights();
};

const openBoard = async () => {
  await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
  for (let i = 0; i < 40; i += 1) {
    await delay(800);
    if (await ev("!!document.querySelector('[data-drama-drag-handle]')")) break;
  }
  await waitForHeights((h) => h.length === 3 && h.every((x) => x > 100));
};

await openBoard();
const before = await shotHeights();
check('三个分段都在', (before ?? []).length === 3, JSON.stringify(before));

// 1. 折叠单个分段
await ev(`(() => {
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')].filter((h) => /分段工作台/.test(h.textContent || ''));
  let scope = heads[0].parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  scope.querySelector('button[aria-label="collapse"]')?.click();
})()`);
await delay(1200);
const afterOne = await shotHeights();
check('单段折叠后变矮', afterOne[0] < before[0] * 0.7, `${before[0]} → ${afterOne[0]}`);
check('其它段不受影响', afterOne[1] === before[1], `${before[1]} → ${afterOne[1]}`);

const oneSaved = await dramaOf(proj.id);
check('折叠状态写进快照', (oneSaved.collapsedShots ?? []).length === 1, JSON.stringify(oneSaved.collapsedShots));

// 2. 刷新后仍然折叠
await openBoard();
const reloaded = await shotHeights();
check('刷新后仍是折叠的', reloaded[0] < before[0] * 0.7, `${reloaded[0]}`);

// 3. 一键折叠全部
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find((h) => /分镜台/.test(h.textContent || ''));
  let scope = head?.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  const btn = scope ? [...scope.querySelectorAll('button')].find((b) => /折叠所有分段/.test(b.textContent || '')) : null;
  btn?.click();
})()`);
await delay(1500);
const allCollapsed = await shotHeights();
const allShort = (allCollapsed ?? []).every((h) => h < before[0] * 0.7);
check('一键折叠全部', allShort, JSON.stringify(allCollapsed));

const allSaved = await dramaOf(proj.id);
check('全部折叠写进快照', (allSaved.collapsedShots ?? []).length === 3, JSON.stringify((allSaved.collapsedShots ?? []).length));

// 4. 再点一次全部展开
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find((h) => /分镜台/.test(h.textContent || ''));
  let scope = head?.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  const btn = scope ? [...scope.querySelectorAll('button')].find((b) => /展开所有分段/.test(b.textContent || '')) : null;
  btn?.click();
})()`);
await delay(1500);
const expanded = await shotHeights();
check('全部展开恢复原高', JSON.stringify(expanded) === JSON.stringify(before), JSON.stringify(expanded));
const cleared = await dramaOf(proj.id);
check('展开后快照清空', (cleared.collapsedShots ?? []).length === 0, JSON.stringify(cleared.collapsedShots));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'collapse.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

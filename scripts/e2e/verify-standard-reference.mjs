// @needs: comfyui
// 标准画布带参考图生成：角色卡挂图 → 连到设定卡 → 生成走编辑工作流
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
mkdirSync(VERIFY_DIR, { recursive: true });

// 一张有明显主体的小图，作为角色的参考
const FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAgUlEQVR4nNXOQQ0AIBDAsJHMFZqQhU9E3IOsCrr2uZRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMT5OzD1AOVGAktNnSC0AAAAAElFTkSuQmCC',
  'base64'
);
const FIXTURE_PATH = VERIFY_DIR + 'standard-reference.png';
if (!existsSync(FIXTURE_PATH)) writeFileSync(FIXTURE_PATH, FIXTURE);

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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

// 干净项目 + 一张已上传的参考图
const list = await (await fetch(`${APP}/api/app/projects`, { headers: H })).json();
for (const stale of (list.projects ?? []).filter((p) => p.name === '标准画布参考图验证')) {
  await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [stale.id] }) });
}
const project = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '标准画布参考图验证', workspaceMode: 'canvas' }),
})).json();

const form = new FormData();
form.append('file', new Blob([FIXTURE], { type: 'image/png' }), 'reference.png');
form.append('assetClass', 'original');
const upload = await (await fetch(`${APP}/api/app/projects/${project.id}/assets`, {
  method: 'POST', headers: { 'x-beatapi-workspace-request': '1', origin: APP }, body: form,
})).json();
const referenceUrl = upload.asset?.publicUrl ?? null;
check('参考图已上传', Boolean(referenceUrl), String(referenceUrl));

// 直接写一份带参考图和连线的板，省掉拖拽
const board = {
  version: 1,
  nodes: [
    { id: 'role-1', kind: 'role', name: '主角', x: 200, y: 90, width: 392, height: 232, imageUrl: referenceUrl, text: '' },
    { id: 'scene-1', kind: 'scene', name: '', x: 700, y: 150, width: 392, height: 212, imageUrl: null, text: '' },
    { id: 'setting-1', kind: 'setting', name: '', x: 600, y: 420, width: 580, height: 200, imageUrl: null, text: '雨夜的旧城区街角，路灯光晕，地面反光' },
  ],
  links: [{ id: 'l1', from: 'role-1', to: 'setting-1' }],
  viewport: { x: 0, y: 0, zoom: 1 },
  composer: { prompt: '', model: 'local', style: 'image' },
};
const before = await (await fetch(`${APP}/api/app/projects/${project.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${project.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    baseVersion: before.version ?? null,
    document: { version: 3, canvasKind: 'standard', cards: [], frames: {}, standard: JSON.stringify(board) },
  }),
});

await send('Page.navigate', { url: `${APP}/zh/standard/${project.id}?t=${Date.now()}` });
for (let i = 0; i < 40; i += 1) {
  await delay(700);
  if (await ev("!!document.querySelector('[data-standard-surface]')")) break;
}
await delay(2500);

const loaded = await ev(`(() => ({
  nodes: document.querySelectorAll('[data-standard-node]').length,
  images: [...document.querySelectorAll('[data-standard-node] img')].filter((i) => i.naturalWidth > 0).length,
  links: (document.querySelector('[data-standard-status]')?.textContent || ''),
}))()`);
check('板载入带图节点', loaded.nodes === 3 && loaded.images >= 1, JSON.stringify(loaded));
check('连线也在', /连线 1/.test(loaded.links), loaded.links);

// 选中设定卡并发起生成
await ev(`(() => {
  const target = document.querySelector('[data-standard-node][data-standard-kind="setting"]');
  target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 700, clientY: 500 }));
})()`);
await delay(600);
await ev(`document.querySelector('[data-standard-generate]')?.click()`);
await delay(2500);

let generated = false;
for (let i = 0; i < 80; i += 1) {
  await delay(5000);
  const shots = await ev(`document.querySelectorAll('[data-standard-kind="shot"]').length`);
  if (shots > 0) { generated = true; console.log(`  …${(i + 1) * 5}s 后出现镜头卡片`); break; }
  const failed = await ev(`(() => {
    const el = [...document.querySelectorAll('span')].find((s) => /失败|failed|error/i.test(s.textContent || ''));
    return el ? (el.textContent || '').slice(0, 80) : null;
  })()`);
  if (failed) { console.log('  生成报错:', failed); break; }
}
check('带参考图的生成成功', generated);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'standard-reference.png', Buffer.from(shot.data, 'base64'));

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

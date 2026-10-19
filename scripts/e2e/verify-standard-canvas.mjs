// 标准画布：结构、连线、缩放、新增节点、生成条、持久化
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
    errors.push(String(msg.params.exceptionDetails?.exception?.description ?? '').slice(0, 180));
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
const mouse = async (type, x, y, button = 'left') =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons: button === 'left' && type !== 'mouseReleased' ? 1 : 0, clickCount: 1 });

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

// Start from a clean project every run: leftover nodes make "three initial nodes" a lie.
const projects = await (await fetch(`${APP}/api/app/projects`, { headers: H })).json();
for (const stale of (projects.projects ?? []).filter((item) => item.name === '标准画布验证')) {
  await fetch(`${APP}/api/app/projects`, {
    method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [stale.id] }),
  });
}
const project = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '标准画布验证', workspaceMode: 'canvas' }),
})).json();

const open = async () => {
  await send('Page.navigate', { url: `${APP}/zh/standard/${project.id}?t=${Date.now()}` });
  for (let i = 0; i < 40; i += 1) {
    await delay(600);
    if (await ev("!!document.querySelector('[data-standard-surface]')")) break;
  }
  await delay(2000);
};
await open();

// 1. 结构
check('画布渲染', (await ev("!!document.querySelector('[data-standard-surface]')")) === true);
check('三个初始节点', (await ev(`document.querySelectorAll('[data-standard-node]').length`)) === 3, 'role/scene/setting');
check('每个节点都有出入口', (await ev(`document.querySelectorAll('[data-port-in]').length`)) === 3 && (await ev(`document.querySelectorAll('[data-port-out]').length`)) === 3);
check('生成条存在', (await ev("!!document.querySelector('[data-standard-composer]')")) === true);
check('缩放控件四个', (await ev(`document.querySelectorAll('[data-standard-zoom]').length`)) === 4);

// 2. 连线：从左卡右侧圆点拖到设定卡左侧圆点
const dragLink = async (fromSel, toSel) => {
  const points = await ev(`(() => {
    const a = document.querySelector('${fromSel}')?.getBoundingClientRect();
    const b = document.querySelector('${toSel}')?.getBoundingClientRect();
    if (!a || !b) return null;
    return { ax: a.left + a.width / 2, ay: a.top + a.height / 2, bx: b.left + b.width / 2, by: b.top + b.height / 2 };
  })()`);
  if (!points) return 'missing';
  await mouse('mousePressed', points.ax, points.ay);
  await mouse('mouseMoved', (points.ax + points.bx) / 2, (points.ay + points.by) / 2);
  await mouse('mouseMoved', points.bx, points.by);
  await mouse('mouseReleased', points.bx, points.by);
  await delay(900);
  return 'ok';
};

const linkIds = await ev(`(() => {
  const cards = [...document.querySelectorAll('[data-standard-node]')];
  return cards.map((c) => c.getAttribute('data-standard-node'));
})()`);
const dragged = await dragLink(`[data-port-out="${linkIds[0]}"]`, `[data-port-in="${linkIds[2]}"]`);
check('拖拽连线可执行', dragged === 'ok', String(dragged));
const statusAfterLink = await ev(`document.querySelector('[data-standard-status]')?.textContent ?? ''`);
check('连线被记进状态栏', /连线 1/.test(statusAfterLink), statusAfterLink);

// 3. 缩放按钮
const zoomBefore = await ev(`document.querySelector('[data-standard-status]')?.textContent ?? ''`);
await ev(`document.querySelector('[data-standard-zoom="in"]')?.click()`);
await delay(600);
const zoomAfter = await ev(`document.querySelector('[data-standard-status]')?.textContent ?? ''`);
check('放大按钮改变缩放', zoomBefore !== zoomAfter, `${zoomBefore} → ${zoomAfter}`);

await ev(`document.querySelector('[data-standard-zoom="reset"]')?.click()`);
await delay(400);
check('重置视图回到 100%', /缩放 100%/.test(await ev(`document.querySelector('[data-standard-status]')?.textContent ?? ''`)));

// 4. 素材库菜单新增节点
const before = await ev(`document.querySelectorAll('[data-standard-node]').length`);
await ev(`document.querySelector('[data-standard-menu="assets"]')?.click()`);
await delay(500);
await ev(`document.querySelector('[data-standard-add="shot"]')?.click()`);
await delay(900);
const after = await ev(`document.querySelectorAll('[data-standard-node]').length`);
check('新增镜头节点', after === before + 1, `${before} → ${after}`);

// 5. 生成条写入设定节点
await ev(`(() => {
  const box = document.querySelector('[data-standard-composer]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(box, '雨夜旧城，路灯昏黄，地面积水反光');
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(400);
await ev(`document.querySelector('[data-standard-generate]')?.click()`);
await delay(1200);
const settingText = await ev(`[...document.querySelectorAll('[data-standard-text]')].map((t) => t.value).join('|')`);
check('生成条内容进了设定节点', String(settingText).includes('雨夜旧城'), String(settingText).slice(0, 40));

// 6. 持久化：刷新后节点数与内容都在
await open();
const persisted = await ev(`(() => ({
  nodes: document.querySelectorAll('[data-standard-node]').length,
  setting: [...document.querySelectorAll('[data-standard-text]')].map((t) => t.value).join('|'),
  status: document.querySelector('[data-standard-status]')?.textContent ?? '',
}))()`);
check('刷新后节点数保留', persisted.nodes === after, `${persisted.nodes} / 期望 ${after}`);
check('刷新后设定文本保留', String(persisted.setting).includes('雨夜旧城'), String(persisted.setting).slice(0, 30));
check('刷新后连线保留', /连线 1/.test(persisted.status), persisted.status);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'standard-canvas-verified.png', Buffer.from(shot.data, 'base64'));

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

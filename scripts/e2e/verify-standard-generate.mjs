// @needs: comfyui
// 标准画布的真实生成：点生成 → ComfyUI 出图 → 落成镜头卡片 → 刷新仍在
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

// 干净项目
const list = await (await fetch(`${APP}/api/app/projects`, { headers: H })).json();
for (const stale of (list.projects ?? []).filter((p) => p.name === '标准画布生成验证')) {
  await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [stale.id] }) });
}
const project = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '标准画布生成验证', workspaceMode: 'canvas' }),
})).json();

const open = async () => {
  await send('Page.navigate', { url: `${APP}/zh/standard/${project.id}?t=${Date.now()}` });
  for (let i = 0; i < 40; i += 1) {
    await delay(600);
    if (await ev("!!document.querySelector('[data-standard-surface]')")) break;
  }
  await delay(2500);
};
await open();
check('画布打开', (await ev("!!document.querySelector('[data-standard-surface]')")) === true);

const nodesBefore = await ev(`document.querySelectorAll('[data-standard-node]').length`);

// 写提示词并发起生成
await ev(`(() => {
  const box = document.querySelector('[data-standard-composer]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(box, 'a single red apple on a pale linen cloth, soft morning light, shallow depth of field');
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(600);
await ev(`document.querySelector('[data-standard-generate]')?.click()`);
await delay(2500);

const busy = await ev(`(() => {
  const btn = document.querySelector('[data-standard-generate]');
  return { text: (btn?.textContent || '').trim(), disabled: !!btn?.disabled };
})()`);
check('按钮进入生成态', busy.disabled === true || /生成中/.test(busy.text), JSON.stringify(busy));

// 等结果：最多 6 分钟
let generated = false;
for (let i = 0; i < 72; i += 1) {
  await delay(5000);
  const state = await ev(`(() => ({
    shots: document.querySelectorAll('[data-standard-kind="shot"]').length,
    imgs: [...document.querySelectorAll('[data-standard-node] img')].length,
    error: document.querySelector('[data-standard-generate]')?.disabled === true ? null : 'idle',
  }))()`);
  if (state.shots > 0) { generated = true; console.log(`  …等 ${(i + 1) * 5}s 后出现镜头卡片`); break; }
}

const after = await ev(`(() => ({
  nodes: document.querySelectorAll('[data-standard-node]').length,
  shots: document.querySelectorAll('[data-standard-kind="shot"]').length,
  withImage: [...document.querySelectorAll('[data-standard-node] img')].filter((img) => img.naturalWidth > 0).length,
}))()`);
check('生成产出了镜头卡片', generated && after.shots >= 1, `${nodesBefore} → ${after.nodes} 节点，镜头 ${after.shots}`);
check('图片真的加载出来了', after.withImage >= 1, `${after.withImage} 张有像素`);

// 刷新后仍在
await open();
const persisted = await ev(`(() => ({
  shots: document.querySelectorAll('[data-standard-kind="shot"]').length,
  withImage: [...document.querySelectorAll('[data-standard-node] img')].filter((img) => img.naturalWidth > 0).length,
}))()`);
check('刷新后镜头还在', persisted.shots >= after.shots, `${persisted.shots} 个`);
check('刷新后图片还能显示', persisted.withImage >= 1, `${persisted.withImage} 张`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'standard-generate.png', Buffer.from(shot.data, 'base64'));

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

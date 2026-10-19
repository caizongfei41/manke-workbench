// 素材库批量删除：选中、全选、确认删除、行与文件一起消失
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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// 造一个独立项目，上传两张真图，用来看「删掉的就是这两张」
const MAKER = '素材删除验证';
const project = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: MAKER, workspaceMode: 'studio' }),
})).json();

// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const uploaded = [];
for (const name of ['删除靶子A.png', '删除靶子B.png']) {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), name);
  form.append('assetClass', 'original');
  const res = await fetch(`${APP}/api/app/projects/${project.id}/assets`, {
    method: 'POST',
    headers: { 'x-beatapi-workspace-request': '1', origin: APP },
    body: form,
  });
  if (!res.ok) { console.log('  上传失败', res.status, await res.text()); process.exit(1); }
  const body = await res.json();
  uploaded.push(body.asset ?? body);
}
check('两个靶子素材已上传', uploaded.length === 2, uploaded.map((a) => a.filename ?? a.id).join(', '));

// 打开素材库，按项目筛到这两个
await send('Page.navigate', { url: `${APP}/zh/assets?t=${Date.now()}` });
for (let i = 0; i < 45; i += 1) {
  await delay(700);
  if (await ev("document.querySelectorAll('[data-library-asset]').length > 0")) break;
}
await delay(1500);

await ev(`(() => {
  const select = document.querySelector('[data-library-project]');
  if (!select) return 'no-select';
  const option = [...select.options].find((o) => (o.textContent || '').includes(${JSON.stringify(MAKER)}));
  if (!option) return 'no-option';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, option.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await delay(1200);

const tiles = await ev(`document.querySelectorAll('[data-library-asset]').length`);
check('筛选后只剩这两个', tiles === 2, `${tiles} 个`);

// 选中一个 → 计数出现
await ev(`document.querySelector('[data-library-select]')?.click()`);
await delay(600);
const bar = await ev(`(() => {
  const el = document.querySelector('[data-library-selection]');
  return el ? (el.textContent || '').trim() : null;
})()`);
check('选中后出现操作条', bar !== null && /1/.test(bar ?? ''), String(bar).slice(0, 40));

// 全选当前
await ev(`(() => {
  const el = document.querySelector('[data-library-selection]');
  const btn = el ? [...el.querySelectorAll('button')].find((b) => /全选|Select shown/.test(b.textContent || '')) : null;
  btn?.click();
})()`);
await delay(600);
const allSel = await ev(`(() => {
  const el = document.querySelector('[data-library-selection]');
  return el ? (el.textContent || '').trim() : null;
})()`);
check('全选后是 2', /2/.test(allSel ?? ''), String(allSel).slice(0, 40));

// 点删除 → 出现确认框 → 确认
await ev(`document.querySelector('[data-library-delete]')?.click()`);
await delay(600);
check('删除前有确认', (await ev(`!!document.querySelector('[data-library-delete-confirm]')`)) === true);

await ev(`document.querySelector('[data-library-delete-confirm]')?.click()`);
await delay(2500);

const left = await ev(`document.querySelectorAll('[data-library-asset]').length`);
check('删除后清空', left === 0, `${left} 个`);

// 数据库里也没了
const after = await (await fetch(`${APP}/api/app/recent-assets?limit=200`, { headers: { origin: APP } })).json();
const all = [...(after.images ?? []), ...(after.videos ?? []), ...(after.audios ?? [])];
const stillThere = uploaded.filter((asset) => all.some((a) => a.id === asset.id));
check('接口里也查不到', stillThere.length === 0, `残留 ${stillThere.length}`);

// 直接打接口，确认文件也删了（storageProvider=local 时 filesRemoved 会+1）
const probe = await fetch(`${APP}/api/app/assets`, {
  method: 'DELETE',
  headers: H,
  body: JSON.stringify({ assetIds: [uploaded[0].id] }),
});
const probeBody = await probe.json();
check('重复删除不报错', probe.ok, JSON.stringify(probeBody));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'library-delete.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [project.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

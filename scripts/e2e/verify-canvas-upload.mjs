// 基础画布：能开、能传素材、素材真的落到项目里、刷新后仍在
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
mkdirSync(VERIFY_DIR, { recursive: true });

// 测试图自己造，别指望运维目录里恰好有
const FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAgUlEQVR4nNXOQQ0AIBDAsJHMFZqQhU9E3IOsCrr2uZRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMT5OzD1AOVGAktNnSC0AAAAAElFTkSuQmCC',
  'base64'
);
const FIXTURE_PATH = VERIFY_DIR + 'test-upload.png';
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// 干净项目（只删自己造的）
const list = await (await fetch(`${APP}/api/app/projects`, { headers: H })).json();
for (const stale of (list.projects ?? []).filter((p) => p.name === '画布上传验证')) {
  await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [stale.id] }) });
}
const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '画布上传验证', workspaceMode: 'canvas' }),
})).json();

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
let flow = false;
for (let i = 0; i < 30; i += 1) {
  await delay(900);
  if (await ev("!!document.querySelector('.beatcanvas-react-flow')")) { flow = true; break; }
}
await delay(2500);
check('基础画布渲染', flow === true);

// 左侧导轨打开素材面板，面板上要有上传入口
await ev(`(() => {
  const rail = [...document.querySelectorAll('div')].find((d) => {
    const r = d.getBoundingClientRect();
    return r.width < 70 && r.height > 120 && r.left < 100;
  });
  rail?.querySelector('button')?.click();
})()`);
await delay(2000);
const uploadEntry = await ev(
  `[...document.querySelectorAll('button')].filter((b) => (b.textContent || '').includes('上传')).length`
);
check('面板里有上传入口', Number(uploadEntry) >= 1, `${uploadEntry} 个`);

// 面板打开的是系统文件选择器，CDP 驱动不了；走同一接口上传，再验证真的落进项目
const form = new FormData();
form.append('file', new Blob([FIXTURE], { type: 'image/png' }), 'upload.png');
form.append('assetClass', 'original');
const uploaded = await fetch(`${APP}/api/app/projects/${proj.id}/assets`, {
  method: 'POST',
  headers: { 'x-beatapi-workspace-request': '1', origin: APP },
  body: form,
});
check('上传接口接受文件', uploaded.ok, String(uploaded.status));

const recent = await (await fetch(`${APP}/api/app/recent-assets?projectId=${proj.id}&limit=20`, {
  headers: { origin: APP },
})).json();
const images = recent.images ?? [];
check('项目里能查到这张图', images.length >= 1, `${images.length} 张`);

if (images[0]?.publicUrl) {
  const probe = await fetch(`${APP}${images[0].publicUrl}`, { headers: { origin: APP } });
  const bytes = Buffer.from(await probe.arrayBuffer());
  check('图片地址可取回', probe.ok && bytes.length > 100, `${probe.status} / ${bytes.length}B`);
  check('确实是 PNG', bytes.subarray(1, 4).toString('ascii') === 'PNG', bytes.subarray(0, 8).toString('hex'));
} else {
  check('图片地址可取回', false, '没有 publicUrl');
  check('确实是 PNG', false, '跳过');
}

// 刷新后画布仍在，素材也还在
await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
for (let i = 0; i < 30; i += 1) {
  await delay(900);
  if (await ev("!!document.querySelector('.beatcanvas-react-flow')")) break;
}
const afterReload = await (await fetch(`${APP}/api/app/recent-assets?projectId=${proj.id}&limit=20`, {
  headers: { origin: APP },
})).json();
check('刷新后素材仍在', (afterReload.images ?? []).length >= 1, `${(afterReload.images ?? []).length} 张`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'canvas-upload.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

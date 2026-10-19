// 跨分段批量挂/卸参考图：一次操作作用于全部段落，写进快照，刷新后仍在
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
  method: 'POST', headers: H, body: JSON.stringify({ name: '批量资产验证', workspaceMode: 'canvas' }),
})).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const shots = [0, 1, 2].map((i) => ({
  id: `s${i + 1}`, index: i, prompt: `第 ${i + 1} 段：中景。`, seconds: 3,
  // 第一段已经挂了角色，用来看「是否重复添加」和「移除是否波及别处」
  publicAssetIds: i === 0 ? ['character-1'] : [],
  ownImageUrls: [], videoUrl: null, versions: [], status: 'idle',
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
        publicAssets: [
          { id: 'character-1', kind: 'character', name: '阿明', description: '', imageUrl: null },
          { id: 'scene-2', kind: 'scene', name: '街头', description: '', imageUrl: null },
        ],
        shots, finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
for (let i = 0; i < 40; i += 1) {
  await delay(800);
  if (await ev("!!document.querySelector('[data-batch-asset]')")) break;
}
await delay(2000);

const before = await dramaOf(proj.id);
check('初始只有第一段有角色', JSON.stringify(before.shots.map((s) => s.publicAssetIds.length)) === '[1,0,0]', JSON.stringify(before.shots.map((s) => s.publicAssetIds)));

// 选中「街头」，挂到全部
const picked = await ev(`(() => {
  const select = document.querySelector('[data-batch-asset]');
  if (!select) return 'no-select';
  const option = [...select.options].find((o) => (o.textContent || '').trim() === '街头');
  if (!option) return 'no-option';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, option.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
check('下拉里有公共资产', picked === 'ok', String(picked));

await delay(600);
const applied = await ev(`(() => {
  const select = document.querySelector('[data-batch-asset]');
  let scope = select?.parentElement;
  const btn = scope ? [...scope.querySelectorAll('button')].find((b) => /挂到全部|Attach/.test(b.textContent || '')) : null;
  btn?.click();
  return btn ? 'ok' : 'no-button';
})()`);
check('挂载按钮可用', applied === 'ok', String(applied));

await delay(1500);
const after = await dramaOf(proj.id);
check('三段都挂上了', after.shots.every((s) => s.publicAssetIds.includes('scene-2')), JSON.stringify(after.shots.map((s) => s.publicAssetIds)));
check('第一段没有被重复添加', after.shots[0].publicAssetIds.filter((id) => id === 'character-1').length === 1, JSON.stringify(after.shots[0].publicAssetIds));
check('原本没有资产的两段只多这一个', after.shots[1].publicAssetIds.length === 1 && after.shots[2].publicAssetIds.length === 1, JSON.stringify(after.shots.map((s) => s.publicAssetIds.length)));

// 再点一次：从全部移除
await delay(400);
const removed = await ev(`(() => {
  const select = document.querySelector('[data-batch-asset]');
  let scope = select?.parentElement;
  const btn = scope ? [...scope.querySelectorAll('button')].find((b) => /从全部|Detach/.test(b.textContent || '')) : null;
  btn?.click();
  return btn ? 'ok' : 'no-detach-button';
})()`);
check('按钮自动切换成移除', removed === 'ok', String(removed));

await delay(1500);
const cleared = await dramaOf(proj.id);
check('街头从全部段落移除', cleared.shots.every((s) => !s.publicAssetIds.includes('scene-2')), JSON.stringify(cleared.shots.map((s) => s.publicAssetIds)));
check('原有角色不受影响', cleared.shots[0].publicAssetIds.includes('character-1'), JSON.stringify(cleared.shots[0].publicAssetIds));

// 刷新后仍是这个状态
await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}?t=${Date.now()}` });
await delay(4000);
const reloaded = await dramaOf(proj.id);
check('刷新后状态保留', JSON.stringify(reloaded.shots.map((s) => s.publicAssetIds)) === JSON.stringify(cleared.shots.map((s) => s.publicAssetIds)), JSON.stringify(reloaded.shots.map((s) => s.publicAssetIds)));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'batch-assets.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

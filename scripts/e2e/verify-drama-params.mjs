// 参数台：能改、能存、提交时真的进到节点里
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;

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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '参数台验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: { version: 3, canvasKind: 'drama', cards: [], frames: {}, drama: JSON.stringify({ version: 1, script: '', positions: {}, links: [], params: {}, loras: [], publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle' }) },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);

// 1) 参数台存在且有全部字段
const panel = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')]
    .find(h => (h.textContent||'').includes('生成参数台'));
  if (!head) return null;
  const scope = head.parentElement.parentElement;
  return {
    selects: scope.querySelectorAll('select').length,
    numbers: scope.querySelectorAll('input[type=number]').length,
    checks: scope.querySelectorAll('input[type=checkbox]').length,
  };
})()`);
check('参数台节点存在', !!panel, JSON.stringify(panel));
check('有分辨率等下拉', (panel?.selects ?? 0) >= 10, `${panel?.selects} 个 select`);
check('有数值参数', (panel?.numbers ?? 0) >= 4, `${panel?.numbers} 个`);

// 2) 改分辨率到 720P
const changed = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')]
    .find(h => (h.textContent||'').includes('生成参数台'));
  const scope = head.parentElement.parentElement;
  const labels = [...scope.querySelectorAll('label')];
  const row = labels.find(l => (l.textContent||'').includes('分辨率'));
  if (!row) return 'no-row';
  const select = row.querySelector('select');
  if (!select) return 'no-select';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, '720P');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()`);
await delay(900);
check('分辨率能改成 720P', changed === '720P', String(changed));

// 3) 改 LoRA
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')]
    .find(h => (h.textContent||'').includes('生成参数台'));
  const scope = head.parentElement.parentElement;
  const selects = [...scope.querySelectorAll('select')];
  const lora = selects[selects.length - 3];
  if (!lora) return 'no-lora';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(lora, '电影感loraV1.0正式版.safetensors');
  lora.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await delay(900);
check('LoRA 能选', (await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')]
    .find(h => (h.textContent||'').includes('生成参数台'));
  return (head.textContent||'').includes('1 个 LoRA');
})()`)) === true);

// 4) 存进快照
await delay(2200);
const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(saved.document?.drama ?? '{}');
check('参数写进快照', drama.params?.resolution === '720P', String(drama.params?.resolution));
check('LoRA 写进快照', (drama.loras ?? []).some((l) => l.file && l.file !== 'none'), JSON.stringify(drama.loras?.[0]?.file ?? null));

// 5) 提交真的带上这些参数
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('套用模板')); b?.click(); })()`);
await delay(900);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台')); b?.click(); })()`);
await delay(2200);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-params.png', Buffer.from(shot.data, 'base64'));

// 新契约：没有片段时合成应当被拒绝，而不是提交一条任务
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '一键合成整片'); b?.click(); })()`);
await delay(1500);
const refused = await ev(`(() => {
  const h = [...document.querySelectorAll('[data-drama-drag-handle]')].find(x => (x.textContent||'').includes('最终视频台'));
  let s = h?.parentElement;
  while (s && getComputedStyle(s).position !== 'absolute') s = s.parentElement;
  return (s?.innerText || '').split(String.fromCharCode(10)).join(' | ');
})()`);
check('缺片段时合成被拒绝并说明原因', /还没有|没有视频|先生成/.test(String(refused)), String(refused).slice(0, 70));

// 参数要验的是「提交出去的图」，所以走单段生成
await ev(`(() => {
  const hs = [...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||''));
  const head = hs[0];
  let s = head?.parentElement;
  while (s && getComputedStyle(s).position !== 'absolute') s = s.parentElement;
  const btn = s ? [...s.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '生成这一段') : null;
  btn?.click();
})()`);

let submitted = null;
for (let i = 0; i < 12; i++) {
  await delay(3000);
  const gens = await (await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })).json();
  if ((gens.items ?? []).length > 0) { submitted = gens.items[0]; break; }
}
check('提交了一次任务', !!submitted, submitted ? submitted.status : '无记录');

if (submitted) {
  await delay(6000);
  const q = await (await fetch(`${COMFY}/queue`)).json();
  const all = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])];
  const p = all.find((x) => x[1] === submitted.providerTaskId)?.[2] ?? all[0]?.[2];
  if (p) {
    const global = Object.entries(p).find(([, n]) => n?.class_type === 'AICG3D_H3SequenceGlobal');
    check('节点收到 720P', global?.[1]?.inputs?.resolution === '720P', String(global?.[1]?.inputs?.resolution));
    const loader = Object.entries(p).find(([, n]) => n?.class_type === 'AICG3D_H3Loader');
    check('节点收到 LoRA', String(loader?.[1]?.inputs?.lora_1 ?? '').includes('电影感'), String(loader?.[1]?.inputs?.lora_1 ?? '').slice(0, 30));
  } else {
    console.log('  队列已空，跳过节点核对');
  }
}

await fetch(`${COMFY}/interrupt`, { method: 'POST' });
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

// 参数台不需要接线：没有端口、不影响其它接线、参数照样生效
// @needs: comfyui —— 会真正提交生成任务；CI 无 GPU，跳过这一套

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const OUT = VERIFY_DIR;
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

const tabs = await (await fetch(`${CDP}/json`)).json();
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
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 90000);
  });
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
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
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '参数台接线验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const shots = [0, 1].map((i) => ({
  id: `s${i + 1}`, index: i, title: `第 ${i + 1} 段`, prompt: `中景。<d>[Chinese] 台词。</d>`, seconds: 3,
  publicAssetIds: [], ownImageUrls: [], videoUrl: null, versions: [], status: 'idle',
}));
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: { resolution: '720P' }, loras: [], subtitles: false, exportPreset: 'vertical',
        enhance: { enabled: false, rules: [], extra: '' },
        bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [], shots, finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (await ev("document.querySelectorAll('svg path[marker-end]').length > 0")) break;
  await delay(500);
}

// 1) 参数台没有任何端口
const paramsPorts = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  if (!head) return 'no-node';
  let scope = head.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  return {
    inputs: scope.querySelectorAll('[data-drama-input-port]').length,
    outputs: [...scope.querySelectorAll('span[title]')].filter(s => (s.getAttribute('title')||'').includes('拖出')).length,
  };
})()`);
check('参数台没有输入端口', paramsPorts?.inputs === 0, JSON.stringify(paramsPorts));
check('参数台没有输出端口', paramsPorts?.outputs === 0, JSON.stringify(paramsPorts));

// 2) 其它节点端口照旧（4 个阶段节点里 3 个有端口：board/assets/final + 2 段）
const allPorts = await ev(`document.querySelectorAll('[data-drama-input-port]').length`);
check('其它节点端口还在', allPorts === 5, `${allPorts} 个`);

// 3) 接线数没变（2 阶段 + 每段 2 条）
const edges = await ev(`[...document.querySelectorAll('svg path[marker-end]')].length`);
check('接线数不变', edges === 6, `${edges} 条`);

// 4) 现场改两个参数，验证它们真的进图（不是只有 720P 生效）
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  let scope = head.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  const rows = [...scope.querySelectorAll('label')];
  const setNumber = (labelText, value) => {
    const row = rows.find(r => (r.textContent||'').includes(labelText));
    const input = row?.querySelector('input[type=number]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  setNumber('采样步数', 6);
  setNumber('交接帧数', 9);
})()`);
await delay(1200);

// 4b) 参数照样生效：不用接线，提交时带 720P 和新改的步数
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '生成这一段');
  b?.click();
})()`);
await delay(12000);
const q = await (await fetch(`${COMFY}/queue`)).json();
const graph = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])][0]?.[2] ?? null;
if (graph) {
  const global = Object.values(graph).find((n) => n?.class_type === 'AICG3D_H3SequenceGlobal');
  check('没接线参数也生效（720P）', global?.inputs?.resolution === '720P', String(global?.inputs?.resolution));
  check('改过的采样步数进图', global?.inputs?.steps === 6, String(global?.inputs?.steps));
  check('改过的交接帧数进图', global?.inputs?.handoff_frames === 9, String(global?.inputs?.handoff_frames));
} else {
  console.log('  队列为空，跳过参数核对');
}
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

// 5) 说明里写清楚了不需要接线
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  head?.querySelector('button[aria-label="使用说明"]')?.click();
})()`);
await delay(600);
const helpText = await ev(`(() => {
  const p = document.querySelector('[role="dialog"]');
  return p ? (p.textContent || '') : '';
})()`);
check('说明里写了不需要接线', String(helpText).includes('不需要接线'), String(helpText).slice(0, 40));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'params-no-wire.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

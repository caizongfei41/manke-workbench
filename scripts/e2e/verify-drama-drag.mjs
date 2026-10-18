// 短剧画布：节点拖拽 / 连线跟随 / 小地图跳转 / 整理布局
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
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
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '拖拽验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: { version: 3, canvasKind: 'drama', cards: [], frames: {}, drama: JSON.stringify({ version: 1, script: '', positions: {}, publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle' }) },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);
// Wait for the board to be measured. A busy tab can take a moment before
// requestAnimationFrame runs and the node rects exist; asserting earlier makes
// this look like a broken feature instead of a slow frame.
for (let attempt = 0; attempt < 20; attempt += 1) {
  const ready = await ev("document.querySelectorAll('svg path[marker-end]').length > 0");
  if (ready === true) break;
  await delay(500);
}

// 建两段
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('套用模板')); b?.click(); })()`);
await delay(900);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台')); b?.click(); })()`);
await delay(2500);

// Screen rect for clicking, plus the content-space position the layout owns.
// Comparing screen coords would be fooled by any pan that happened in between.
const nodeAt = (name) =>
  ev(`(() => {
    const heads = [...document.querySelectorAll('[data-drama-drag-handle]')];
    const head = heads.find(h => (h.textContent||'').includes(${JSON.stringify(name)}));
    if (!head) return null;
    const card = head.parentElement;
    let abs = card;
    while (abs && getComputedStyle(abs).position !== 'absolute') abs = abs.parentElement;
    const r = card.getBoundingClientRect();
    return {
      left: Math.round(r.left), top: Math.round(r.top),
      cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2),
      headX: Math.round(r.left + 40), headY: Math.round(r.top + 14),
      contentX: abs ? parseInt(abs.style.left || '0', 10) : 0,
      contentY: abs ? parseInt(abs.style.top || '0', 10) : 0,
    };
  })()`);

const edgePaths = () =>
  ev(`(() => {
    const svg = [...document.querySelectorAll('svg')].find(s => s.querySelector('#drama-arrow'));
    if (!svg) return [];
    return [...svg.querySelectorAll('path')].filter(p => p.getAttribute('marker-end')).map(p => p.getAttribute('d'));
  })()`);

const boardBefore = await nodeAt('分镜台');
check('分镜台节点存在', !!boardBefore, JSON.stringify(boardBefore));

const pathsBefore = await edgePaths();
check('连线已绘制', Array.isArray(pathsBefore) && pathsBefore.length >= 3, `${pathsBefore.length} 条`);

// 拖动分镜台
if (boardBefore) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: boardBefore.headX, y: boardBefore.headY, button: 'left', buttons: 1, clickCount: 1 });
  await delay(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: boardBefore.headX + 60, y: boardBefore.headY + 160, button: 'left', buttons: 1 });
  await delay(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: boardBefore.headX + 120, y: boardBefore.headY + 320, button: 'left', buttons: 1 });
  await delay(250);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: boardBefore.headX + 120, y: boardBefore.headY + 320, button: 'left', buttons: 0, clickCount: 1 });
  await delay(700);
}

const boardAfter = await nodeAt('分镜台');
const dx = boardAfter && boardBefore ? boardAfter.contentX - boardBefore.contentX : 0;
const dy = boardAfter && boardBefore ? boardAfter.contentY - boardBefore.contentY : 0;
check('节点可拖动', Math.abs(dx) > 30 && Math.abs(dy) > 60, `移动 ${dx},${dy}`);

const pathsAfter = await edgePaths();
check('连线跟着节点走', JSON.stringify(pathsBefore) !== JSON.stringify(pathsAfter), `${pathsAfter.length} 条`);

// 拖动后仍在视口内可操作
check('拖后节点仍在文档中', !!boardAfter);

// 位置已持久化
await delay(2200);
const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(saved.document?.drama ?? '{}');
check('位置写进了快照', !!drama.positions?.board, JSON.stringify(drama.positions?.board ?? null));

// 重新打开位置还在
await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);
const reopen = await nodeAt('分镜台');
const reopenDx = reopen && boardBefore ? reopen.contentX - boardBefore.contentX : 0;
check('重开后位置保留', Math.abs(reopenDx) > 30, `偏移 ${reopenDx}`);

// 小地图点击跳转
const viewBefore = await ev(`(() => {
  const s = document.querySelector('.origin-top-left');
  const m = getComputedStyle(s).transform.match(/matrix\\(([^)]+)\\)/);
  const p = m ? m[1].split(',').map(Number) : [1,0,0,1,0,0];
  return { tx: Math.round(p[4]), ty: Math.round(p[5]) };
})()`);
await ev(`(() => {
  const mm = [...document.querySelectorAll('div')].find(d => d.querySelector('svg[width="168"]') && d.getBoundingClientRect().width === 168);
  if (!mm) return 'missing';
  const r = mm.getBoundingClientRect();
  mm.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20, pointerId: 1, button: 0, buttons: 1 }));
  mm.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20, pointerId: 1, button: 0, buttons: 0 }));
  return 'ok';
})()`);
await delay(800);
const viewAfter = await ev(`(() => {
  const s = document.querySelector('.origin-top-left');
  const m = getComputedStyle(s).transform.match(/matrix\\(([^)]+)\\)/);
  const p = m ? m[1].split(',').map(Number) : [1,0,0,1,0,0];
  return { tx: Math.round(p[4]), ty: Math.round(p[5]) };
})()`);
check('点小地图会跳转视图', viewBefore.tx !== viewAfter.tx || viewBefore.ty !== viewAfter.ty, `${viewBefore.tx},${viewBefore.ty} → ${viewAfter.tx},${viewAfter.ty}`);

// 整理布局
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '整理布局'); b?.click(); })()`);
await delay(1200);
const reset = await nodeAt('分镜台');
const resetDx = reset && boardBefore ? reset.contentX - boardBefore.contentX : 999;
check('整理布局恢复默认位置', Math.abs(resetDx) < 40, `偏移 ${resetDx}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-drag.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

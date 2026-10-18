// 短剧画布视口：缩放、平移、适配、快捷键、小地图
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
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '视口验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: { version: 3, canvasKind: 'drama', cards: [], frames: {}, drama: JSON.stringify({ version: 1, script: '', publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle' }) },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);

// 放大：给几段，让内容比视口宽
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('套用模板')); b?.click(); })()`);
await delay(1000);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台')); b?.click(); })()`);
await delay(2500);

const readView = () =>
  ev(`(() => {
    const stage = document.querySelector('[data-drama-stage], .origin-top-left');
    if (!stage) return null;
    const t = getComputedStyle(stage).transform;
    const m = t.match(/matrix\\(([^)]+)\\)/);
    if (!m) return { scale: 1, tx: 0, ty: 0 };
    const [a, , , , tx, ty] = m[1].split(',').map(Number);
    return { scale: Number(a.toFixed(3)), tx: Math.round(tx), ty: Math.round(ty) };
  })()`);

// 工具条按钮存在
const bar = await ev(`(() => {
  const labels = ['缩小','放大','适配视图','撤销','重做'];
  return labels.filter(l => [...document.querySelectorAll('button')].some(b => (b.getAttribute('aria-label')||'') === l));
})()`);
check('有完整缩放工具条', Array.isArray(bar) && bar.length === 5, String(bar));

const initial = await readView();
check('首次进入自动适配', initial && initial.scale < 1.01, JSON.stringify(initial));

// 点放大
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '放大'); b?.click(); })()`);
await delay(700);
const zoomed = await readView();
check('放大生效', zoomed && zoomed.scale > initial.scale, `${initial?.scale} → ${zoomed?.scale}`);

// 点缩小两次
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '缩小'); b?.click(); })()`);
await delay(500);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '缩小'); b?.click(); })()`);
await delay(700);
const shrunk = await readView();
check('缩小生效', shrunk && shrunk.scale < zoomed.scale, `${zoomed?.scale} → ${shrunk?.scale}`);

// 点百分比回 100%
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('%')); b?.click(); })()`);
await delay(700);
const reset = await readView();
check('点百分比回到 100%', reset && Math.abs(reset.scale - 1) < 0.01, String(reset?.scale));

// 适配
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '适配视图'); b?.click(); })()`);
await delay(800);
const fitted = await readView();
check('适配视图生效', fitted && fitted.scale < 1.01, JSON.stringify(fitted));

// 滚轮缩放（ctrl+wheel）
await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 500, deltaX: 0, deltaY: -240, modifiers: 2 });
await delay(700);
const wheeled = await readView();
check('Ctrl+滚轮缩放生效', wheeled && wheeled.scale !== fitted.scale, `${fitted?.scale} → ${wheeled?.scale}`);

// 拖动空白平移
const beforePan = await readView();
// 空白点不能写死：节点会挪位置，参数台就可能盖住原来的落点
const empty = await ev(`(() => {
  for (let y = 860; y >= 540; y -= 40) {
    for (let x = 120; x <= 1500; x += 80) {
      const el = document.elementFromPoint(x, y);
      if (el && el.dataset && el.dataset.dramaBackground === 'true') return { x, y };
    }
  }
  return null;
})()`);
check('找得到画布空白处', !!empty, JSON.stringify(empty));
const startX = empty?.x ?? 700;
const startY = empty?.y ?? 900;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'middle', buttons: 4, clickCount: 1 });
await delay(150);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX + 80, y: startY - 25, button: 'middle', buttons: 4 });
await delay(150);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX + 200, y: startY - 60, button: 'middle', buttons: 4 });
await delay(150);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX + 200, y: startY - 60, button: 'middle', buttons: 0, clickCount: 1 });
await delay(600);
const afterPan = await readView();
check('中键拖空白处可平移', afterPan && (afterPan.tx !== beforePan.tx || afterPan.ty !== beforePan.ty), `${beforePan?.tx},${beforePan?.ty} → ${afterPan?.tx},${afterPan?.ty}`);

// 快捷键
await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 8, key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 8, key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
await delay(800);
const shortcutFit = await readView();
check('Shift+1 适配', shortcutFit && shortcutFit.scale < 1.01, String(shortcutFit?.scale));

// 小地图
const minimap = await ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find(s => (s.getAttribute('width')||'') === '168');
  if (!svg) return null;
  return svg.querySelectorAll('rect').length;
})()`);
check('小地图渲染了节点块', typeof minimap === 'number' && minimap >= 4, `${minimap} 个`);

// 卡片输入框在缩放后仍然可编辑（不被平移层吃掉事件）
const editable = await ev(`(() => {
  const t = document.querySelector('textarea');
  if (!t) return 'no-textarea';
  t.focus();
  return document.activeElement === t ? 'ok' : 'not-focused';
})()`);
check('缩放后输入框仍可聚焦', editable === 'ok', String(editable));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-viewport.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

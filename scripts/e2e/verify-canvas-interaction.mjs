// 交互便利性：右键平移、滚轮平移、Ctrl+滚轮缩放、Esc/Ctrl+A、双击适配、加分段自动定位
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;

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
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '交互验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const shots = [0, 1, 2].map((i) => ({
  id: `s${i + 1}`, index: i, title: `第 ${i + 1} 段`,
  prompt: `中景。<d>[Chinese] 台词。</d>`, seconds: 3,
  publicAssetIds: [], ownImageUrls: [], videoUrl: null, versions: [], status: 'idle',
}));
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: {}, loras: [], subtitles: true, exportPreset: 'vertical',
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

const view = () => ev(`(() => {
  const s = document.querySelector('.origin-top-left');
  if (!s) return null;
  const m = getComputedStyle(s).transform.match(/matrix\\(([^)]+)\\)/);
  const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  return { tx: Math.round(p[4]), ty: Math.round(p[5]), k: Number(p[0].toFixed(3)) };
})()`);

const empty = await ev(`(() => {
  for (let y = 860; y >= 300; y -= 40) {
    for (let x = 120; x <= 1500; x += 80) {
      const el = document.elementFromPoint(x, y);
      if (el && el.dataset && el.dataset.dramaBackground === 'true') return { x, y };
    }
  }
  return null;
})()`);
check('找得到空白处', !!empty, JSON.stringify(empty));
const ox = empty?.x ?? 120;
const oy = empty?.y ?? 860;

// 1) 右键拖动平移
let before = await view();
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ox, y: oy, button: 'right', buttons: 2, clickCount: 1 });
await delay(150);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ox + 120, y: oy - 80, button: 'right', buttons: 2 });
await delay(150);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ox + 120, y: oy - 80, button: 'right', buttons: 0, clickCount: 1 });
await delay(500);
let after = await view();
check('右键拖动可以平移', after.tx - before.tx === 120 && after.ty - before.ty === -80,
  `${before.tx},${before.ty} → ${after.tx},${after.ty}`);

// 2) 右键不会弹出系统菜单（contextmenu 被拦）
const menuBlocked = await ev(`(() => {
  const ev2 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  const target = document.querySelector('[data-drama-background="true"]');
  target.dispatchEvent(ev2);
  return ev2.defaultPrevented;
})()`);
check('右键菜单被拦下', menuBlocked === true);

// 3) 滚轮平移（不缩放）
before = await view();
await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: ox, y: oy, deltaX: 0, deltaY: 150 });
await delay(500);
after = await view();
check('滚轮用于平移而不是缩放', after.ty !== before.ty && after.k === before.k,
  `ty ${before.ty} → ${after.ty}, k ${after.k}`);

// 4) Ctrl+滚轮缩放
before = await view();
await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: ox, y: oy, deltaX: 0, deltaY: -240, modifiers: 2 });
await delay(500);
after = await view();
check('Ctrl+滚轮缩放', after.k > before.k, `k ${before.k} → ${after.k}`);

// 5) Ctrl+A 全选，Esc 取消
await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
await delay(600);
const selected = await ev(`document.querySelectorAll('.ring-2').length`);
check('Ctrl+A 全选分段', selected === 3, `${selected} 个`);

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await delay(500);
check('Esc 取消选择', (await ev(`document.querySelectorAll('.ring-2').length`)) === 0);

// 6) 双击空白适配
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '放大'); b?.click(); })()`);
await delay(600);
before = await view();
// 真双击要两组 press/release：第二组 clickCount=2 才会合成 dblclick
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ox, y: oy, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ox, y: oy, button: 'left', buttons: 0, clickCount: 1 });
await delay(60);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ox, y: oy, button: 'left', buttons: 1, clickCount: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ox, y: oy, button: 'left', buttons: 0, clickCount: 2 });
await delay(700);
after = await view();
check('双击空白会适配视图', after.k !== before.k || after.tx !== before.tx,
  `k ${before.k} → ${after.k}`);

// 7) 加一个分段自动定位到新节点
const shotsBefore = await ev(`[...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||'')).length`);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('加一个分段工作台')); b?.click(); })()`);
await delay(1200);
const shotsAfter = await ev(`[...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||'')).length`);
check('加了一个分段', shotsAfter === shotsBefore + 1, `${shotsBefore} → ${shotsAfter}`);

const lastVisible = await ev(`(() => {
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||''));
  const last = heads[heads.length - 1];
  if (!last) return null;
  const r = last.getBoundingClientRect();
  return { inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth, top: Math.round(r.top) };
})()`);
check('新分段落在视野内', lastVisible?.inView === true, JSON.stringify(lastVisible));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'interaction.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

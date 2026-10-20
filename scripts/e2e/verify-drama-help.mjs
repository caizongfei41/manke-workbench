// 悬浮说明窗：每个节点都有、内容正确、缩放后不被缩小、点外面/Esc 关闭
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
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '说明验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const shots = [0, 1].map((i) => ({
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

// 1) 每个节点都有说明按钮
const buttons = await ev(`document.querySelectorAll('button[aria-label="使用说明"]').length`);
check('每个节点都有说明按钮', buttons >= 7, `${buttons} 个（含工具条）`);

// 2) 打开一个，检查内容与位置
const opened = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /分段工作台 1/.test(h.textContent||''));
  if (!head) return 'no-node';
  const btn = head.querySelector('button[aria-label="使用说明"]');
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
})()`);
await delay(500);
check('点击打开说明', opened === 'clicked', opened);

const panel = await ev(`(() => {
  const p = document.querySelector('[role="dialog"]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    title: (p.querySelector('span')?.textContent ?? '').trim(),
    text: (p.innerText || '').replace(/\\n+/g, ' | ').slice(0, 80),
    w: Math.round(r.width), h: Math.round(r.height),
    inView: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
  };
})()`);
check('说明窗出现了', !!panel, JSON.stringify(panel));
check('标题是分段工作台', panel?.title === '分段工作台', String(panel?.title));
check('内容讲了版本与采用', String(panel?.text).includes('采用这版'), String(panel?.text).slice(0, 50));
check('完整落在视口内', panel?.inView === true, `${panel?.w}x${panel?.h}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'help-open.png', Buffer.from(shot.data, 'base64'));

// Baseline before zooming, so the check compares like with like instead of a fixed px value.
const base = await ev(`(() => {
  const p = document.querySelector('[role="dialog"]');
  const para = p?.querySelector('p');
  return para ? { fontSize: parseFloat(getComputedStyle(para).fontSize) } : null;
})()`);

// 3) 缩放到 50% 后，说明窗字号不变（因为挂在 body 上）
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '缩小'); b?.click(); b?.click(); b?.click(); })()`);
await delay(900);
const zoomed = await ev(`(() => {
  const p = document.querySelector('[role="dialog"]');
  if (!p) return null;
  const cs = getComputedStyle(p);
  const para = p.querySelector('p');
  return { width: Math.round(p.getBoundingClientRect().width), fontSize: parseFloat(getComputedStyle(para).fontSize) };
})()`);
check('缩放后说明窗尺寸不变', zoomed?.width === 268, `${zoomed?.width}px`);
check('缩放后字号不变', zoomed?.fontSize === base?.fontSize, `${base?.fontSize}px → ${zoomed?.fontSize}px`);

// 4) 点外面关闭
await ev(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
await delay(400);
check('点外面关闭', (await ev(`!document.querySelector('[role="dialog"]')`)) === true);

// 5) Esc 关闭
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /剧本/.test(h.textContent||''));
  head?.querySelector('button[aria-label="使用说明"]')?.click();
})()`);
await delay(400);
check('再次打开', (await ev(`!!document.querySelector('[role="dialog"]')`)) === true);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await delay(400);
check('Esc 关闭', (await ev(`!document.querySelector('[role="dialog"]')`)) === true);

// 6) 工具条的画布说明
await ev(`(() => {
  const btns = [...document.querySelectorAll('button[aria-label="使用说明"]')];
  btns[btns.length - 1]?.click();
})()`);
await delay(500);
const canvasHelp = await ev(`(() => {
  const p = document.querySelector('[role="dialog"]');
  return p ? { title: (p.querySelector('span')?.textContent ?? '').trim(), text: (p.textContent||'') } : null;
})()`);
check('工具条有画布说明', canvasHelp?.title === '画布操作', String(canvasHelp?.title));
check('提到了框选与平移', String(canvasHelp?.text).includes('框选') && String(canvasHelp?.text).includes('平移'), String(canvasHelp?.text).slice(0, 60));
await ev(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);

// 7) 三个语言都有内容
const en = await (await fetch(`${APP}/en/canvas/${proj.id}`)).text();
check('英文页面能加载', en.includes('漫客') || en.length > 1000, `${en.length} 字节`);

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

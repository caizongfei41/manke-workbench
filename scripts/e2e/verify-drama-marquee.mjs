// 框选多选 + 批量删除 + 提示词增强
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

// A job left running by an earlier suite keeps the page busy and makes drags
// land late; stop it before measuring anything.
await fetch(`${COMFY}/interrupt`, { method: "POST" }).catch(() => {});
const queueBefore = await fetch(`${COMFY}/queue`).then((r) => r.json()).catch(() => null);
for (const pendingItem of queueBefore?.queue_pending ?? []) {
  await fetch(`${COMFY}/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delete: [pendingItem[0]] }),
  }).catch(() => {});
}
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '框选验证', workspaceMode: 'canvas' }) })).json();
const shots = [0, 1, 2].map((i) => ({
  id: `s${i + 1}`, index: i, title: `第 ${i + 1} 段`,
  prompt: `镜头 ${i + 1}。<d>[Chinese] 台词 ${i + 1}。</d>`,
  seconds: 3, publicAssetIds: [], ownImageUrls: [], videoUrl: null, versions: [], status: 'idle',
}));
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
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

const empty = await ev(`(() => {
  for (let y = 860; y >= 540; y -= 40) {
    for (let x = 120; x <= 1500; x += 80) {
      const el = document.elementFromPoint(x, y);
      if (el && el.dataset && el.dataset.dramaBackground === 'true') return { x, y };
    }
  }
  return null;
})()`);
check('找得到空白处', !!empty, JSON.stringify(empty));

// 1) 框选：从左上拖到右下，覆盖分段区域
const boxes = await ev(`(() => {
  return [...document.querySelectorAll('[data-drama-drag-handle]')]
    .filter(h => /分段工作台/.test(h.textContent||''))
    .map(h => { const r = h.parentElement.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; });
})()`);
check('三个分段都在', Array.isArray(boxes) && boxes.length === 3, `${boxes?.length} 个`);

if (boxes && boxes.length === 3) {
  // 起点必须是空白：卡片会吃掉 pointerdown
  const start = await ev(`(() => {
    const cards = [...document.querySelectorAll('[data-drama-drag-handle]')]
      .filter(h => /分段工作台/.test(h.textContent||''))
      .map(h => h.parentElement.getBoundingClientRect());
    const minX = Math.min(...cards.map(r => r.left));
    const minY = Math.min(...cards.map(r => r.top));
    for (let y = Math.round(minY) - 20; y >= 120; y -= 30) {
      for (let x = Math.round(minX) - 20; x >= 80; x -= 30) {
        const el = document.elementFromPoint(x, y);
        if (el && el.dataset && el.dataset.dramaBackground === 'true') return { x, y };
      }
    }
    return null;
  })()`);
  check('找得到框选起点', !!start, JSON.stringify(start));

  const x1 = start?.x ?? 200;
  const y1 = start?.y ?? 200;
  const x2 = Math.max(...boxes.map((b) => b.r)) + 40;
  const y2 = Math.max(...boxes.map((b) => b.b)) + 40;

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  await delay(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), button: 'left', buttons: 1 });
  await delay(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, button: 'left', buttons: 1 });
  await delay(250);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  await delay(700);
}

// NodeShell 内部多了一层 relative，所以状态类要沿祖先找到绝对定位的那层
// 前面套件留下的忙态会让 Drag 偶发不触发；重拖一次就够了
if ((await ev("document.querySelectorAll('.ring-2').length")) === 0 && empty) {
  const x1r = empty.x;
  const y1r = empty.y;
  const x2r = Math.max(...boxes.map((b) => b.r)) + 40;
  const y2r = Math.max(...boxes.map((b) => b.b)) + 40;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1r, y: y1r, button: 'left', buttons: 1, clickCount: 1 });
  await delay(200);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round((x1r + x2r) / 2), y: Math.round((y1r + y2r) / 2), button: 'left', buttons: 1 });
  await delay(200);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2r, y: y2r, button: 'left', buttons: 1 });
  await delay(300);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2r, y: y2r, button: 'left', buttons: 0, clickCount: 1 });
  await delay(800);
}

const selected = await ev(`(() => {
  const wrapperOf = (head) => {
    let el = head.parentElement;
    while (el && getComputedStyle(el).position !== 'absolute') el = el.parentElement;
    return el;
  };
  const mine = [...document.querySelectorAll('[data-drama-drag-handle]')]
    .filter(h => /分段工作台/.test(h.textContent||''))
    .filter(h => (wrapperOf(h)?.className || '').toString().includes('ring-2'));
  return { shots: mine.length, total: document.querySelectorAll('.ring-2').length };
})()`);
check('框选选中了 3 个分段', selected?.shots === 3, `分段 ${selected?.shots} 个 / 总 ${selected?.total} 个`);

// 2) Delete 批量删除
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
await delay(2200);
const after = await ev(`(() => {
  return [...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||'')).length;
})()`);
check('批量删除后没有分段', after === 0, `${after} 个`);

const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(saved.document?.drama ?? '{}');
check('快照里分段也清了', (drama.shots ?? []).length === 0, `${(drama.shots ?? []).length} 个`);
const shotIds = new Set(['s1', 's2', 's3']);
check(
  '相关接线也清了，阶段间保留',
  !(drama.links ?? []).some((l) => shotIds.has(l.from) || shotIds.has(l.to)) &&
    (drama.links ?? []).some((l) => l.from === 'script' && l.to === 'board'),
  JSON.stringify(drama.links ?? [])
);

// 3) 提示词增强
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('套用模板'));
  b?.click();
})()`);
await delay(900);
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台'));
  b?.click();
})()`);
await delay(2200);

const enhanceUi = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  if (!head) return null;
  const scope = head.parentElement.parentElement;
  return {
    hasTitle: (scope.innerText||'').includes('提示词增强'),
    hasToggle: !!scope.querySelector('input[type=checkbox]'),
  };
})()`);
check('参数台有提示词增强', enhanceUi?.hasTitle === true);
check('有总开关', enhanceUi?.hasToggle === true);

await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  const scope = head.parentElement.parentElement;
  const boxes = [...scope.querySelectorAll('input[type=checkbox]')];
  const enhance = boxes[boxes.length - 1];
  enhance.click();
})()`);
await delay(700);
const ruleLabels = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  const scope = head.parentElement.parentElement;
  return [...scope.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(t => ['只他一人','锁机位','锁光线','不要文字'].includes(t));
})()`);
check('开启后出现四条规则', Array.isArray(ruleLabels) && ruleLabels.length === 4, String(ruleLabels?.length));

await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  const scope = head.parentElement.parentElement;
  [...scope.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '只他一人')?.click();
})()`);
await delay(2000);
const saved2 = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama2 = JSON.parse(saved2.document?.drama ?? '{}');
check('开启写进快照', drama2.enhance?.enabled === true);
check('规则写进快照', (drama2.enhance?.rules ?? []).includes('soloSubject'), JSON.stringify(drama2.enhance?.rules));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-marquee.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

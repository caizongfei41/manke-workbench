// 画布导演台：新建生成节点 → 切视频 → 选 AICG3D → 导入剧本 → 提交 → 核对注入
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
    if (!/Project not found/.test(text)) errors.push(text.slice(0, 200));
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
const clickText = (text) =>
  ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes(${JSON.stringify(text)}));
    if (!b) return 'missing';
    b.click();
    return 'ok';
  })()`);

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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '画布导演台' }) })).json();

// 先清空 ComfyUI 队列，避免比对到旧任务
await fetch(`${COMFY}/interrupt`, { method: 'POST' });
const q0 = await (await fetch(`${COMFY}/queue`)).json();
for (const it of [...(q0.queue_running ?? []), ...(q0.queue_pending ?? [])]) {
  await fetch(`${COMFY}/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delete: [it[1]] }),
  });
}

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) {
  await delay(900);
  if ((await ev("!!document.querySelector('.beatcanvas-react-flow')")) === true) break;
}
await delay(3000);

// 新建生成节点并点开 composer
await ev(`(() => {
  const rail = [...document.querySelectorAll('div')].find(d => {
    const r = d.getBoundingClientRect();
    return r.width < 70 && r.height > 120 && r.left < 100;
  });
  rail?.querySelector('button')?.click();
})()`);
await delay(2500);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 580, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 580, button: 'left', clickCount: 1 });
await delay(2500);
check('composer 出现', (await ev("document.querySelectorAll('textarea').length")) > 0);

// 切视频
check('切到视频', (await clickText('图片')) === 'ok');
await delay(1200);
await ev(`(() => {
  const o = [...document.querySelectorAll('button, div')]
    .find(x => (x.textContent||'').trim() === '视频' && x.getBoundingClientRect().height > 20);
  o?.click();
})()`);
await delay(2200);

// 选 AICG3D 长视频
await ev(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find(x => (x.textContent||'').includes('MiniMax') || (x.textContent||'').includes('长视频'));
  b?.click();
})()`);
await delay(1200);
const picked = await ev(`(() => {
  const o = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim().includes('长视频 · 画质优先'));
  if (!o) return 'missing';
  o.click();
  return 'ok';
})()`);
await delay(2500);
check('选中 AICG3D 长视频', picked === 'ok');

check(
  '画布出现分段导演台',
  (await ev("[...document.querySelectorAll('span')].some(s => (s.textContent||'').trim() === '分段导演台')")) === true
);

const layout = await ev(`(() => {
  const panel = document.querySelector('[data-composer-panel]');
  const ta = [...document.querySelectorAll('textarea')].find(x => (x.placeholder||'').includes('描述镜头'));
  const p = panel ? panel.getBoundingClientRect() : null;
  const r = ta ? ta.getBoundingClientRect() : null;
  return {
    panelH: p ? Math.round(p.height) : 0,
    taH: r ? Math.round(r.height) : 0,
    taW: r ? Math.round(r.width) : 0,
    overlap: p && r ? Math.round(Math.max(0, p.bottom - r.top)) : -1,
  };
})()`);
check('面板与输入框不重叠', layout.overlap === 0, JSON.stringify(layout));
check('输入框可见', layout.taH > 20 && layout.taW > 100, `${layout.taW}x${layout.taH}`);

// 导入剧本 → 套用模板 → 切分
await clickText('导入剧本');
await delay(1000);
await clickText('套用模板');
await delay(800);
await clickText('切分成分镜');
await delay(1500);
check(
  '画布切出 2 段',
  (await ev("[...document.querySelectorAll('span')].some(s => (s.textContent||'').includes('2 段'))")) === true
);

// 主提示词：canvas 的 textarea 需要真实输入事件
const box = await ev(`(() => {
  const t = [...document.querySelectorAll('textarea')].find(x => (x.placeholder||'').includes('描述镜头'));
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
if (box) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await delay(400);
  await send('Input.insertText', { text: '雨夜街头，霓虹碎在积水里' });
  await delay(1000);
}
const promptLen = await ev(
  "([...document.querySelectorAll('textarea')].find(x => (x.placeholder||'').includes('描述镜头'))||{}).value?.length ?? 0"
);
check('主提示词已填', promptLen > 5, `${promptLen} 字`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'canvas-director.png', Buffer.from(shot.data, 'base64'));

// 提交：只认「开始生成」，别匹配到「关闭生成器」
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '开始生成');
  b?.click();
})()`);

let hit = null;
for (let i = 0; i < 15; i++) {
  await delay(3000);
  const gens = await (
    await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })
  ).json();
  const items = gens.items ?? [];
  if (items.length > 0) { hit = items[0]; break; }
}
check('画布提交成功', !!hit, hit ? hit.status : '无记录');

if (hit) {
  const q = await (await fetch(`${COMFY}/queue`)).json();
  const all = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])];
  const p = all.find((x) => x[1] === hit.providerTaskId)?.[2] ?? all[0]?.[2];
  if (p) {
    const segs = Object.entries(p).filter(([, n]) => n?.class_type === 'AICG3D_H3SequenceSegment');
    const prompts = segs.map(([, n]) =>
      String(n.inputs.prompt).replace('integrated_multimodal_description: ', '').slice(0, 12)
    );
    check('分段数与分镜一致（2 段）', segs.length === 2, `${segs.length} 个节点`);
    check('每段提示词不同', new Set(prompts).size === segs.length, prompts.join(' | '));
  } else {
    console.log('  队列已空，跳过节点检查');
  }
  await fetch(`${COMFY}/interrupt`, { method: 'POST' });
}

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

// 画布：素材上传 / 导入分镜 / 40 段分镜提交
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
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '画布40段' }) })).json();

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

// 新建生成卡片并打开 composer
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

await clickText('图片');
await delay(1200);
await ev(`(() => {
  const o = [...document.querySelectorAll('button, div')]
    .find(x => (x.textContent||'').trim() === '视频' && x.getBoundingClientRect().height > 20);
  o?.click();
})()`);
await delay(2200);
await ev(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find(x => (x.textContent||'').includes('MiniMax') || (x.textContent||'').includes('长视频'));
  b?.click();
})()`);
await delay(1200);
await ev(`(() => {
  const o = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim().includes('长视频 · 480P'));
  o?.click();
})()`);
await delay(2500);
check(
  '画布导演台出现',
  (await ev("[...document.querySelectorAll('span')].some(s => (s.textContent||'').trim() === '分段导演台')")) === true
);

// 素材页：上传按钮是否可点（没接回调时是死的）
await ev("[...document.querySelectorAll('button')].find(b => (b.textContent||'').trim().startsWith('素材'))?.click()");
await delay(1000);
await clickText('导入剧本');
await delay(900);

// 生成一份 40 段的剧本（3 秒一段 = 120 秒）
const shotLines = [];
for (let i = 1; i <= 40; i += 1) {
  shotLines.push(`【第${i}段｜3秒】`);
  shotLines.push(`0.0～0.6秒：镜头 ${i}，雨夜街头，霓虹在积水里散开。`);
  shotLines.push(`0.6～2.4秒：角色1 (S1) says: <d>[Chinese] 第 ${i} 句台词。</d>`);
  shotLines.push(`2.4～3.0秒：雨滴落下。`);
  shotLines.push('');
}
const script = `【人物】\n阿明：28 岁，黑色风衣\n小雅：24 岁，白色连衣裙\n\n【场景】\n雨夜街头：深夜，冷色调\n\n【道具】\n旧怀表：黄铜外壳\n\n${shotLines.join('\n')}`;

await ev(`(() => {
  const panelOpen = [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('切分成分镜'));
  return panelOpen;
})()`);
await ev(`(() => {
  const t = [...document.querySelectorAll('textarea')].find(x => (x.placeholder||'').includes('剧本'));
  if (!t) return 'no-textarea';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, ${JSON.stringify(script)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await delay(800);
await clickText('切分成分镜');
await delay(2000);

const summary = await ev(`(() => {
  const spans = [...document.querySelectorAll('span')].map(s => (s.textContent||'').trim());
  const i = spans.indexOf('分段导演台');
  return i >= 0 ? spans[i+1] : '?';
})()`);
check('切出 40 段', String(summary).includes('40 段'), summary);

const assetCount = await ev(`(() => {
  const spans = [...document.querySelectorAll('span')].map(s => (s.textContent||'').trim());
  return ['阿明','小雅','雨夜街头','旧怀表'].filter(n => spans.includes(n)).length;
})()`);
check('识别出 4 个素材', assetCount === 4, String(assetCount));

// 上传按钮是否真的能触发文件选择（检查隐藏 input 存在且回调已接）
const uploadWired = await ev(`(() => {
  const inputs = [...document.querySelectorAll('input[type=file]')];
  return inputs.length;
})()`);
check('存在文件选择入口', uploadWired > 0, `${uploadWired} 个`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'canvas-40-shots.png', Buffer.from(shot.data, 'base64'));

// 主提示词
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

// 提交
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
check('40 段任务已提交', !!hit, hit ? hit.status : '无记录');

if (hit) {
  await delay(6000);
  const q = await (await fetch(`${COMFY}/queue`)).json();
  const all = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])];
  const p = all.find((x) => x[1] === hit.providerTaskId)?.[2] ?? all[0]?.[2];
  if (p) {
    const segs = Object.entries(p).filter(([, n]) => n?.class_type === 'AICG3D_H3SequenceSegment');
    const total = segs.reduce((a, [, n]) => a + Number(n.inputs.seconds || 0), 0);
    check('展开成 40 段', segs.length === 40, `${segs.length} 个节点`);
    check('总时长 120 秒', total === 120, `${total} 秒`);
    const prompts = new Set(segs.map(([, n]) => String(n.inputs.prompt)));
    check('40 段提示词各不相同', prompts.size === 40, `${prompts.size} 种`);
    const combo = Object.entries(p).find(([, n]) => n?.class_type === 'AICG3D_H3SequenceCombine');
    check('合成节点指向最后一段', String(combo?.[1]?.inputs?.final_segment?.[0]) === segs[segs.length - 1][0], JSON.stringify(combo?.[1]?.inputs?.final_segment));
  } else {
    console.log('  队列已空，跳过节点检查');
  }
}

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

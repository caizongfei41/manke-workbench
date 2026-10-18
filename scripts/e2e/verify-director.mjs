// 导演台验证：界面出现 → 导入剧本 → 分镜 → 参数 → LoRA → 真实提交并检查 ComfyUI 收到的节点值
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
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

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
    errors.push(String(m.params.exceptionDetails?.exception?.description ?? '').slice(0, 160));
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await ev(`localStorage.setItem('manke-theme','light')`);

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '导演台验证' }) })).json();

await send('Page.navigate', { url: `${APP}/zh/studio/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(800); if ((await ev(`!!document.querySelector('[data-beatapi-composer]')`)) === true) break; }
await delay(2000);

// 切到视频 + AICG3D 长视频
await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Media type"]')?.click()`);
await delay(800);
await ev(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent||'').trim() === '视频')?.click()`);
await delay(2200);
await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Model"]')?.click()`);
await delay(900);
const mIdx = await ev(`[...document.querySelectorAll('[role="option"]')].findIndex(o => (o.textContent||'').includes('长视频 · 画质优先'))`);
check('找到 AICG3D 长视频模型', mIdx >= 0, `索引 ${mIdx}`);
if (mIdx >= 0) {
  await ev(`[...document.querySelectorAll('[role="option"]')][${mIdx}]?.click()`);
  await delay(2500);
}

const hasConsole = await ev(`[...document.querySelectorAll('[data-beatapi-composer] span')].some(s => (s.textContent||'').trim() === '分段导演台')`);
check('导演台面板出现', hasConsole === true);

// 导入剧本
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').includes('导入剧本'))?.click()`);
await delay(900);
const script = `镜头 1
雨夜的街头，霓虹在积水里碎成一片光，镜头缓慢推进

镜头 2
她撑伞走过斑马线，回头看了一眼镜头

镜头 3
雨停了，天边泛白，她消失在人群里`;
await ev(`(() => {
  const t = [...document.querySelectorAll('[data-beatapi-composer] textarea')].find(x => (x.placeholder||'').includes('剧本'));
  if (!t) return 'no textarea';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, ${JSON.stringify(script)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await delay(800);
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').includes('切分成分镜'))?.click()`);
await delay(1500);

const summary = await ev(`(() => {
  const spans = [...document.querySelectorAll('[data-beatapi-composer] span')].map(s => (s.textContent||'').trim());
  const i = spans.indexOf('分段导演台');
  return i >= 0 ? spans[i+1] : '?';
})()`);
check('剧本切成 3 段', String(summary).includes('3 段'), summary);

// 生成参数页
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').trim() === '生成参数')?.click()`);
await delay(1200);
const globalFields = await ev(`[...document.querySelectorAll('[data-beatapi-composer] button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(Boolean).length`);
check('生成参数字段存在', globalFields > 10, `${globalFields} 个控件`);

// 改分辨率到 480P
const changed = await ev(`(() => {
  const b = [...document.querySelectorAll('[data-beatapi-composer] button[aria-label="分辨率"]')][0];
  if (!b) return 'no 分辨率';
  b.click();
  return 'ok';
})()`);
await delay(800);
await ev(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent||'').trim() === '480P')?.click()`);
await delay(1000);
check('分辨率可改', changed === 'ok', String(await ev(`[...document.querySelectorAll('[data-beatapi-composer] button[aria-label="分辨率"]')][0]?.textContent?.trim()`)));

// LoRA 页
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').trim() === 'LoRA')?.click()`);
await delay(1200);
const loraSlots = await ev(`[...document.querySelectorAll('[data-beatapi-composer] button[aria-label^="槽 "]')].length`);
check('LoRA 9 个槽位', loraSlots === 9, `${loraSlots} 个`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'director-console.png', Buffer.from(shot.data, 'base64'));

// 主提示词（不填会被前置校验拦下）
await ev(`(() => {
  const t = document.querySelector('[data-beatapi-composer] textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, '雨夜的街头');
  t.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(800);

// 提交并检查 ComfyUI 收到的值
// 队列里可能还留着别的套件的任务，先清空，否则会读到别人的节点。
await fetch(`${COMFY}/interrupt`, { method: 'POST' });
{
  const stale = await (await fetch(`${COMFY}/queue`)).json();
  for (const item of [...(stale.queue_running ?? []), ...(stale.queue_pending ?? [])]) {
    await fetch(`${COMFY}/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: [item[1]] }),
    });
  }
}

const before = Date.now();
const submitBefore = await (
    await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })
  ).json();
const seenIds = new Set((submitBefore.items ?? []).map((x) => x.id));

await ev(`(() => {
  const btns = [...document.querySelectorAll('[data-beatapi-composer] button')];
  btns[btns.length - 1].click();
})()`);
await delay(7000);

// The queue was emptied before submitting, so the only job in it is ours.
const q = await (await fetch(`${COMFY}/queue`)).json();
const all = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])];
check('队列里只有本次任务', all.length === 1, `${all.length} 条`);
const prompt = all[0]?.[2];
if (prompt) {
  const global = Object.entries(prompt).find(([, n]) => n?.class_type === 'AICG3D_H3SequenceGlobal');
  check('全局参数节点收到 480P', global?.[1]?.inputs?.resolution === '480P', String(global?.[1]?.inputs?.resolution));
  const segs = Object.entries(prompt).filter(([, n]) => n?.class_type === 'AICG3D_H3SequenceSegment');
  check('3 个分段节点', segs.length === 3, `${segs.length} 个`);
  const prompts = segs.map(([, n]) => String(n.inputs.prompt ?? '').replace('integrated_multimodal_description: ', '').slice(0, 12));
  const distinct = new Set(prompts).size;
  check('每段提示词互不相同', distinct === 3, prompts.join(' | '));
  const secs = segs.map(([, n]) => n.inputs.seconds);
  check('每段时长已写入', secs.every((v) => typeof v === 'number' && v > 0), secs.join(','));
} else {
  check('提交到 ComfyUI', false, '队列里没有任务');
}
await fetch(`${COMFY}/interrupt`, { method: 'POST' });

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');

ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

// 端到端：在 UI 里真的点一次生成，等结果落到列表。
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
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (!m.id) return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
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

await send('Page.enable');
// Chromium throttles background tabs, which stops requestAnimationFrame and
// leaves the board unmeasured. Make this tab the active one.
await send('Page.bringToFront');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '端到端验证' }) })).json();

console.log('项目:', proj.id.slice(0, 8));
await send('Page.navigate', { url: `${APP}/zh/studio/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(800); if ((await ev(`!!document.querySelector('[data-beatapi-composer]')`)) === true) break; }
await delay(2000);

// 图片模式 + 4 步加速模型（最快）
await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Media type"]')?.click()`);
await delay(700);
await ev(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent||'').trim() === '图片')?.click()`);
await delay(1800);
await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Model"]')?.click()`);
await delay(900);
const has4 = await ev(`[...document.querySelectorAll('[role="option"]')].some(o => (o.textContent||'').includes('4 步加速'))`);
console.log('下拉里有 4 步加速模型:', has4);
if (has4) {
  const idx = await ev(`[...document.querySelectorAll('[role="option"]')].findIndex(o => (o.textContent||'').includes('文生图 4 步加速'))`);
  await ev(`[...document.querySelectorAll('[role="option"]')][${idx}]?.click()`);
  await delay(1800);
}
console.log('当前模型:', await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Model"]')?.textContent?.trim()`));

// 填提示词
await ev(`(() => {
  const t = document.querySelector('[data-beatapi-composer] textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, 'a red apple on a wooden table, soft light');
  t.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(800);
console.log('提示词:', await ev(`document.querySelector('[data-beatapi-composer] textarea')?.value`));

// 点生成
const clicked = await ev(`(() => {
  const b = document.querySelector('[data-beatapi-composer] button[aria-label]');
  const btns = [...document.querySelectorAll('[data-beatapi-composer] button')];
  const gen = btns[btns.length - 1];
  if (!gen) return '没有生成按钮';
  gen.click();
  return 'clicked';
})()`);
console.log('点生成:', clicked);

// 等结果（最多 120s）
let done = false;
for (let i = 0; i < 60; i++) {
  await delay(2000);
  const state = await ev(`(() => {
    const feed = document.querySelector('[data-beatapi-composer]')?.parentElement?.parentElement;
    const text = document.body.innerText;
    return {
      hasImg: document.querySelectorAll('main img, [class*="feed"] img').length,
      busy: /生成中|排队|processing|Generating/.test(text),
      err: /失败|Error|error/.test(text.slice(0, 400)),
    };
  })()`);
  if (i % 5 === 0) console.log(`  [${(i + 1) * 2}s] 图片 ${state.hasImg} 张, 忙碌=${state.busy}`);
  if (state.hasImg > 4) { done = true; break; }
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'e2e-result.png', Buffer.from(shot.data, 'base64'));

// 从接口确认
const gens = await (await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })).json();
const items = gens.items ?? gens ?? [];
console.log('\n接口里的生成记录:', items.length, '条');
for (const it of items.slice(0, 3)) {
  console.log(`  ${it.status}  ${it.mediaType}  ${it.resultUrl ? '有结果' : '无结果'}  ${it.error ?? ''}`);
}
const succeeded = items.some((it) => it.status === 'succeeded' && it.resultUrl);
console.log('\n端到端结果:', succeeded ? '✓ 生成成功且落库' : '✗ 未成功');

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });
ws.close();
process.exit(succeeded ? 0 : 1);

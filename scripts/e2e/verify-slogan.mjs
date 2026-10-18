// 主页标语：三段轮流 + 每条都必须单行
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
await ev("localStorage.setItem('manke-theme','light')");

const measure = () =>
  ev(`(() => {
    const h1 = document.querySelector('h1');
    const span = h1 ? h1.querySelector('span') : null;
    if (!span) return null;
    const cs = getComputedStyle(span);
    const lineHeight = parseFloat(cs.lineHeight) || 0;
    const rect = span.getBoundingClientRect();
    return {
      text: span.textContent.trim(),
      lines: lineHeight > 0 ? Math.round(rect.height / lineHeight) : 0,
      overflow: span.scrollWidth > span.clientWidth + 1,
      fontSize: Math.round(parseFloat(cs.fontSize)),
      width: Math.round(rect.width),
      viewport: window.innerWidth,
    };
  })()`);

await send('Page.navigate', { url: `${APP}/zh` });
// 4.2 秒才轮播一次，早点测才抓得到第一条
for (let i = 0; i < 20; i++) {
  await delay(250);
  if (await ev("!!document.querySelector('h1 span')")) break;
}
await delay(400);

const seen = [];
const start = await measure();
if (start) { seen.push(start.text); check('首屏第一条是品牌名', start.text === '漫客工作台', start.text); }

// 收集三轮，每条都检查单行
for (let i = 0; i < 45; i++) {
  await delay(500);
  const now = await measure();
  if (!now) continue;
  if (!seen.includes(now.text)) {
    seen.push(now.text);
    check(`第 ${seen.length} 条单行显示`, now.lines === 1 && !now.overflow, `行数=${now.lines} 溢出=${now.overflow} 字号=${now.fontSize}px 宽=${now.width}`);
    if (seen.length === 3) break;
  }
}

check('三条标语都出现了', seen.length === 3, String(seen.length));
check(
  '顺序为 1→2→3',
  seen[0] === '漫客工作台' &&
    seen[1].startsWith('一画一影一曲') &&
    seen[2].startsWith('图生万象'),
  seen.join(' / ')
);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'home-slogan-3.png', Buffer.from(shot.data, 'base64'));

// 窄屏：不能溢出、不能换行
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await delay(1500);
let narrowOk = true;
let narrowDetail = '';
for (let i = 0; i < 12; i++) {
  const now = await measure();
  if (now) {
    narrowDetail = `${now.text} 行数=${now.lines} 溢出=${now.overflow} 字号=${now.fontSize}px`;
    if (now.lines !== 1 || now.overflow) { narrowOk = false; break; }
  }
  await delay(700);
}
check('390px 窄屏仍单行不溢出', narrowOk, narrowDetail);

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
ws.close();
process.exit(fails.length ? 1 : 0);

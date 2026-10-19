// 命令面板：`/` 与 Ctrl+K 打开、过滤、方向键选择、回车跳转、Esc 关闭、输入框内不抢键
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';
const OUT = VERIFY_DIR;
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

mkdirSync(OUT, { recursive: true });

const tabs = await (await fetch(`${CDP}/json`)).json();
for (const extra of tabs.filter((t) => t.type === 'page' && /:3020/.test(t.url ?? '')).slice(1)) {
  await fetch(`${CDP}/json/close/${extra.id}`).catch(() => {});
}
let tab = tabs.find((t) => t.type === 'page' && /:3020/.test(t.url ?? ''));
if (!tab) {
  tab = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}/zh`, { method: 'PUT' })).json();
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(String(msg.params.exceptionDetails?.exception?.description ?? '').slice(0, 160));
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description ?? '');
  return r.result.value;
};

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name + (detail ? '  ' + detail : '')); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

const press = async (key, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code: key === '/' ? 'Slash' : key, modifiers,
    windowsVirtualKeyCode: key === '/' ? 191 : key === 'Escape' ? 27 : key === 'Enter' ? 13 : 0,
  });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === '/' ? 'Slash' : key, modifiers });
};

const openState = () => ev(`(() => {
  const d = document.querySelector('[role="dialog"][aria-label]');
  if (!d || !d.querySelector('input')) return null;
  return { label: d.getAttribute('aria-label'), items: d.querySelectorAll('[data-command]').length };
})()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// 先造一个项目，让「项目搜索」有内容
const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ name: '命令面板验证项目', workspaceMode: 'studio' }),
})).json();

await send('Page.navigate', { url: `${APP}/zh` });
for (let i = 0; i < 30; i += 1) { await delay(700); if (await ev("document.readyState === 'complete'")) break; }
await delay(2000);

// ── 1. `/` 打开 ──────────────────────────────────────
await ev("document.body.focus()");
await press('/');
await delay(600);
const opened = await openState();
check('斜杠打开面板', !!opened, JSON.stringify(opened));
check('有导航项', (opened?.items ?? 0) >= 4, `${opened?.items ?? 0} 项`);

// ── 2. 过滤 ──────────────────────────────────────────
await ev(`(() => {
  const input = document.querySelector('[role="dialog"] input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '命令面板验证');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(700);
const filtered = await ev(`(() => {
  const rows = [...document.querySelectorAll('[data-command]')];
  return rows.map((r) => (r.textContent || '').trim());
})()`);
check('按名字过滤到项目', (filtered ?? []).length === 1, JSON.stringify(filtered).slice(0, 80));

// ── 3. Esc 关闭 ──────────────────────────────────────
await press('Escape');
await delay(500);
check('Esc 关闭面板', (await openState()) === null);

// ── 4. Ctrl+K 打开并跳转 ─────────────────────────────
await ev("document.body.focus()");
await press('k', 2); // ctrl
await delay(600);
check('Ctrl+K 打开面板', !!(await openState()));

await ev(`(() => {
  const input = document.querySelector('[role="dialog"] input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '命令面板验证');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(600);
await press('Enter');
await delay(2500);
const path = await ev('location.pathname');
check('回车跳到该项目', String(path).includes(proj.id), String(path));
check('跳转后面板已关闭', (await openState()) === null);

// ── 5. 输入框里按 `/` 不抢键 ─────────────────────────
await send('Page.navigate', { url: `${APP}/zh/studio/${proj.id}` });
for (let i = 0; i < 30; i += 1) { await delay(700); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2000);
// 冷页面里 focus 可能还没生效，确认焦点到位再模拟按键
for (let i = 0; i < 20; i += 1) {
  await ev(`document.querySelector('textarea')?.focus()`);
  if (await ev(`document.activeElement?.tagName === 'TEXTAREA'`)) break;
  await delay(300);
}
await ev(`(() => { const t = document.querySelector('textarea'); t?.focus(); })()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
await send('Input.dispatchKeyEvent', { type: 'char', text: '/', key: '/', code: 'Slash' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
await delay(600);
const typing = await openState();
const textareaValue = await ev(`document.querySelector('textarea')?.value ?? ''`);
check('输入框内按斜杠不打开面板', typing === null, JSON.stringify(typing));
check('斜杠进了输入框', String(textareaValue).includes('/'), JSON.stringify(textareaValue));

const shot = await send('Page.captureScreenshot', { format: 'png' });
const shotFile = OUT + 'command-palette.png';
writeFileSync(shotFile, Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, {
  method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }),
});

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

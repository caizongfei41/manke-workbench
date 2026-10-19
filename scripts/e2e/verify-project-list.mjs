// 项目列表：搜索、按空间筛选、排序、行内重命名
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
mkdirSync(VERIFY_DIR, { recursive: true });

const tabs = await (await fetch(`${CDP}/json`)).json();
for (const extra of tabs.filter((t) => t.type === 'page' && /:3020/.test(t.url ?? '')).slice(1)) {
  await fetch(`${CDP}/json/close/${extra.id}`).catch(() => {});
}
let tab = tabs.find((t) => t.type === 'page' && /:3020/.test(t.url ?? ''));
if (!tab) tab = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}/zh`, { method: 'PUT' })).json();
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


// 等元素出现再点：?.click() 会把"还没渲染"静默吞掉，失败信息就成了谜
const clickWhenReady = async (selector, timeoutMs = 8000) => {
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    const result = await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      el.click();
      return 'ok';
    })()`);
    if (result === 'ok') return 'ok';
    await delay(250);
  }
  return 'timeout';
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// 三个名字可辨的项目，分布在两种工作空间
const made = [];
for (const [name, mode] of [['甲项目 搜索靶子', 'studio'], ['乙项目 另一个', 'canvas'], ['丙项目 第三个', 'editor']]) {
  const project = await (await fetch(`${APP}/api/app/projects`, {
    method: 'POST', headers: H, body: JSON.stringify({ name, workspaceMode: mode }),
  })).json();
  made.push(project);
}

const openList = async () => {
  await send('Page.navigate', { url: `${APP}/zh/projects?t=${Date.now()}` });
  for (let i = 0; i < 40; i += 1) {
    await delay(700);
    if (await ev("!!document.querySelector('[data-project-search]')")) break;
  }
  await delay(1500);
};
await openList();

const cards = () => ev(`[...document.querySelectorAll('[data-project-card]')].length`);
const names = () => ev(`[...document.querySelectorAll('[data-project-card] h2')].map((h) => (h.textContent || '').trim())`);

const total = await cards();
check('工具栏出现了', total > 0, `${total} 个项目`);

// 1. 搜索
await ev(`(() => {
  const input = document.querySelector('[data-project-search]');
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '甲项目');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(900);
const searched = await names();
check('搜索把列表收到一个', searched.length === 1 && searched[0].includes('甲项目'), JSON.stringify(searched));

// 2. 搜不到时给空状态
await ev(`(() => {
  const input = document.querySelector('[data-project-search]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '不存在的名字zzz');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(900);
const empty = await ev(`!!document.querySelector('[data-project-empty]')`);
check('无匹配时显示空状态', empty === true);

// 3. 清除筛选
await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /清除筛选|Clear/.test(b.textContent || ''));
  btn?.click();
})()`);
await delay(900);
const restored = await cards();
check('清除筛选后恢复全部', restored === total, `${restored} / ${total}`);

// 4. 按工作空间筛选
await ev(`(() => {
  const select = document.querySelector('[data-project-filter]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'editor');
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await delay(900);
const filtered = await names();
check(
  '按剪辑空间筛选生效',
  filtered.some((n) => n.includes('丙项目')) && !filtered.some((n) => n.includes('甲项目') || n.includes('乙项目')),
  JSON.stringify(filtered).slice(0, 60)
);

// 5. 排序：切到按名称
await ev(`(() => {
  const select = document.querySelector('[data-project-filter]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'all');
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await delay(600);
await ev(`(() => {
  const select = document.querySelector('[data-project-sort]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'name');
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await delay(900);
const sorted = await names();
const isSorted = JSON.stringify(sorted) === JSON.stringify([...sorted].sort((a, b) => a.localeCompare(b, 'zh')));
check('按名称排序', isSorted, JSON.stringify(sorted).slice(0, 60));

// 6. 行内重命名
await ev(`(() => {
  const input = document.querySelector('[data-project-search]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '甲项目');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(800);
const renameClicked = await clickWhenReady('[data-rename-project]');
check('重命名按钮可点', renameClicked === 'ok', renameClicked);
await delay(500);
const hasInput = await ev(`!!document.querySelector('[data-rename-input]')`);
check('重命名输入框出现', hasInput === true);

await ev(`(() => {
  const input = document.querySelector('[data-rename-input]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '甲项目 改过名');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await delay(1500);

const saved = await (await fetch(`${APP}/api/app/projects`, { headers: { origin: APP } })).json();
const renamed = (saved.projects ?? []).find((p) => p.id === made[0].id);
check('重命名写进了数据库', renamed?.name === '甲项目 改过名', String(renamed?.name));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'project-list.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: made.map((p) => p.id) }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

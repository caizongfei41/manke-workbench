// 全量验证：UI 层。
// 逐页真实点击，同时捕获 console error / 未捕获异常，任何一条都算失败。
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';

const tabs = await (await fetch(`${CDP}/json`)).json();

// Keep exactly one tab. Every suite leaves one behind, and a throttled stale
// tab makes the board never get measured — wires and drags then silently fail.
for (const extra of tabs.filter((t) => t.type === 'page' && /3020/.test(t.url)).slice(1)) {
  await fetch(`${CDP}/json/close/${extra.id}`).catch(() => {});
}
const tab = tabs.find((t) => t.type === 'page' && /3020/.test(t.url));
if (!tab) { console.log('没有工作台页面'); process.exit(1); }

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});

let seq = 0;
const pending = new Map();
let consoleErrors = [];
let activePage = '';

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id) {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  // 收集页面侧错误
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (text && !/favicon|Download the React DevTools/.test(text)) {
      consoleErrors.push(`[${activePage}] console.error: ${text.slice(0, 160)}`);
    }
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const text = d?.exception?.description ?? d?.text ?? '';
    consoleErrors.push(`[${activePage}] uncaught: ${String(text).slice(0, 200)}`);
  }
});

const send = (method, params = {}) => {
  const n = ++seq;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((res, rej) => {
    pending.set(n, { resolve: res, reject: rej });
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 45000);
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
  else { fails.push(`${name}${detail ? '  ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

const gotoTab = async (path, readyExpr, label) => {
  activePage = label;
  await send('Page.navigate', { url: APP + path });
  for (let i = 0; i < 30; i++) {
    await delay(800);
    if ((await ev(readyExpr)) === true) return true;
  }
  return false;
};

await send('Page.enable');
// Chromium throttles background tabs, which stops requestAnimationFrame and
// leaves the board unmeasured. Make this tab the active one.
await send('Page.bringToFront');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

// 项目供各页使用
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'UI全量验证' }) })).json();

// ---------- 首页 ----------
console.log('\n=== 首页 ===');
check('加载首页', await gotoTab('/zh', `!!document.querySelector('h1')`));
check('主题切换器存在', (await ev(`!!document.querySelector('[role="radiogroup"]')`)) === true);
check('导航有 3 个链接', (await ev(`document.querySelectorAll('header a[href]').length`)) >= 3);
check('工作空间卡片 3 张', (await ev(`document.querySelectorAll('a[href*="/studio"], a[href*="/canvas"], a[href*="/projects"]').length`)) >= 2);
{
  const before = await ev(`document.documentElement.dataset.theme`);
  await ev(`[...document.querySelectorAll('[role="radio"]')].find(b => (b.getAttribute('aria-label')||'')==='深色')?.click()`);
  await delay(900);
  const after = await ev(`document.documentElement.dataset.theme`);
  check('深色切换生效', before !== after || after === 'dark', `${before} → ${after}`);
  await ev(`[...document.querySelectorAll('[role="radio"]')].find(b => (b.getAttribute('aria-label')||'')==='浅色')?.click()`);
  await delay(700);
  check('浅色切换生效', (await ev(`document.documentElement.dataset.theme`)) === 'light');
}

// ---------- 项目列表 ----------
console.log('\n=== 项目列表 ===');
check('加载项目页', await gotoTab('/zh/projects', `document.body.innerText.length > 200`));
check('有项目条目', (await ev(`document.querySelectorAll('a[href*="/studio/"], a[href*="/canvas/"]').length`)) > 0);

// ---------- 创作台 ----------
console.log('\n=== 创作台 ===');
check('加载创作台', await gotoTab(`/zh/studio/${proj.id}`, `!!document.querySelector('[data-beatapi-composer]')`));

const mediaOptions = async () => {
  await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Media type"]')?.click()`);
  await delay(800);
  const opts = await ev(`[...document.querySelectorAll('[role="option"]')].map(o => (o.textContent||'').trim())`);
  return opts;
};

{
  const opts = await mediaOptions();
  check('媒体下拉 4 项', Array.isArray(opts) && opts.length === 4, String(opts));
  await ev(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent||'').trim() === '图片')?.click()`);
  await delay(1500);
}

// 逐媒体类型切模型
for (const [media, expectPrefix] of [['视频', 'MiniMax'], ['音乐', 'YuE2'], ['图片', 'Qwen']]) {
  await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Media type"]')?.click()`);
  await delay(700);
  await ev(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent||'').trim() === '${media}')?.click()`);
  await delay(2200);
  const model = await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Model"]')?.textContent?.trim()`);
  check(`${media}模式模型正确`, String(model).startsWith(expectPrefix), model);
}

// 音乐模式专属控件 —— 循环最后停在「图片」，先切回音乐
{
  await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Media type"]')?.click()`);
  await delay(700);
  await ev(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent||'').trim() === '音乐')?.click()`);
  await delay(2500);
  const hasDesk = await ev(`[...document.querySelectorAll('[data-beatapi-composer] span')].some(s => (s.textContent||'').trim() === '音乐工作台')`);
  check('音乐工作台面板', hasDesk === true);
  const groups = await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].map(b => (b.textContent||'').trim()).filter(t => ['风格与语言','人声','编曲与乐器','高级'].includes(t)).length`);
  check('四个参数标签页', groups === 4, `${groups} 个`);
  await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').trim() === '高级')?.click()`);
  await delay(1000);
  const hasSeed = await ev(`[...document.querySelectorAll('[data-beatapi-composer] span')].some(s => (s.textContent||'').trim() === '随机种子')`);
  check('高级页有随机种子', hasSeed === true);
  // 切回风格页
  await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').trim() === '风格与语言')?.click()`);
  await delay(800);
  // 歌词模板按钮
  await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').includes('插入结构模板'))?.click()`);
  await delay(1200);
  const prompt = await ev(`document.querySelector('[data-beatapi-composer] textarea')?.value ?? ''`);
  check('插入歌词模板', String(prompt).includes('[Intro]'), `${String(prompt).length} 字符`);
  // 清空
  await ev(`(() => { const t = document.querySelector('[data-beatapi-composer] textarea'); const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; s.call(t,''); t.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await delay(600);
}

// 翻唱切换
{
  await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Model"]')?.click()`);
  await delay(900);
  const idx = await ev(`[...document.querySelectorAll('[role="option"]')].findIndex(o => (o.textContent||'').includes('翻唱'))`);
  if (idx >= 0) {
    await ev(`[...document.querySelectorAll('[role="option"]')][${idx}]?.click()`);
    await delay(1800);
    const model = await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Model"]')?.textContent?.trim()`);
    check('切到翻唱模型', String(model).includes('翻唱'), model);
    const uploadBtn = await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].some(b => (b.textContent||'').includes('上传源歌曲'))`);
    check('翻唱有上传入口', uploadBtn === true);
  } else check('切到翻唱模型', false, '下拉里没有翻唱');
}

// ---------- 画布 ----------
console.log('\n=== 画布 ===');
check('加载画布', await gotoTab(`/zh/canvas/${proj.id}`, `!!document.querySelector('.beatcanvas-react-flow')`));
check('画布有工具栏', (await ev(`document.querySelectorAll('button').length`)) > 5);

// ---------- 剪辑 ----------
console.log('\n=== 剪辑 ===');
{
  const ok = await gotoTab(`/zh/editor/${proj.id}`, `document.body.innerText.length > 100`);
  check('加载剪辑页', ok);
}

// ---------- 素材 ----------
console.log('\n=== 素材 ===');
check('加载素材页', await gotoTab(`/zh/assets/${proj.id}`, `document.body.innerText.length > 100`));

// ---------- 服务 ----------
console.log('\n=== 服务页 ===');
check('加载服务页', await gotoTab('/zh/services', `document.body.innerText.includes('环境') || document.body.innerText.includes('服务')`));
{
  const hasEnv = await ev(`document.body.innerText.includes('环境自检')`);
  check('有环境自检面板', hasEnv === true);
}

// ---------- 清理 ----------
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) { console.log('失败项:'); fails.forEach((f) => console.log('  - ' + f)); }
if (consoleErrors.length) {
  console.log(`\n页面上报了 ${consoleErrors.length} 条错误:`);
  [...new Set(consoleErrors)].slice(0, 20).forEach((e) => console.log('  ! ' + e));
} else {
  console.log('\n页面无 console.error / 未捕获异常 ✓');
}

ws.close();
process.exit(fails.length || consoleErrors.length ? 1 : 0);

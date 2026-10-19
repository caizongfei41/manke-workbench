// 入口与双向导航：标准画布能从首页进、剪辑台能回画布、玻璃面生效
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
    errors.push(String(msg.params.exceptionDetails?.exception?.description ?? '').slice(0, 180));
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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

const projects = await (await fetch(`${APP}/api/app/projects`, { headers: H })).json();
const project = (projects.projects ?? [])[0];
check('有可用项目', Boolean(project), project?.name ?? '');

// 1. 首页有标准画布入口
await send('Page.navigate', { url: `${APP}/zh?t=${Date.now()}` });
await delay(7000);
const home = await ev(`(() => {
  const links = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
  return {
    standard: links.some((href) => href.endsWith('/standard')),
    glass: getComputedStyle(document.querySelector('.beat-glass') ?? document.body).backdropFilter,
    cards: document.querySelectorAll('.beat-glass').length,
  };
})()`);
check('首页有标准画布入口', home.standard === true);
check('首页玻璃面生效', String(home.glass).includes('blur'), String(home.glass));
check('玻璃卡片不止一张', home.cards > 3, String(home.cards));

// 2. /standard 自动进到某块板
await send('Page.navigate', { url: `${APP}/zh/standard?t=${Date.now()}` });
await delay(8000);
const standard = await ev(`(() => ({
  url: location.pathname,
  surface: !!document.querySelector('[data-standard-surface]'),
  nodes: document.querySelectorAll('[data-standard-node]').length,
}))()`);
check('/standard 落到具体画布', /^\/zh\/standard\/[0-9a-f-]{8,}/.test(standard.url), standard.url);
check('画布渲染出节点', standard.surface === true && standard.nodes > 0, `${standard.nodes} 个`);

// 3. 剪辑台能回画布
await send('Page.navigate', { url: `${APP}/zh/editor/${project.id}?t=${Date.now()}` });
await delay(8000);
const editor = await ev(`(() => {
  const link = document.querySelector('[data-editor-back-to-canvas]');
  return link ? { href: link.getAttribute('href'), text: (link.textContent || '').trim() } : null;
})()`);
check('剪辑台有回画布入口', editor !== null, JSON.stringify(editor));
check('入口指向画布', String(editor?.href ?? '').includes(`/canvas/${project.id}`), String(editor?.href));

// 4. 素材库与项目页的玻璃面
for (const [name, path, selector] of [
  ['素材库', '/zh/assets', '.beat-glass'],
  ['项目页', '/zh/projects', '.beat-glass'],
]) {
  await send('Page.navigate', { url: `${APP}${path}?t=${Date.now()}` });
  await delay(6000);
  const state = await ev(`(() => {
    const el = document.querySelector('${selector}');
    return el ? getComputedStyle(el).backdropFilter : 'none';
  })()`);
  check(`${name}玻璃面生效`, String(state).includes('blur'), String(state));
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'entries.png', Buffer.from(shot.data, 'base64'));

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

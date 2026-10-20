// 四个入口：新图、中文文案、点了真的进对应功能
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

// ── A. 工作室空状态 ─────────────────────────────────────
const studio = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '入口验证-工作台', workspaceMode: 'studio' }) })).json();
await send('Page.navigate', { url: `${APP}/zh/studio/${studio.id}` });
for (let i = 0; i < 30; i++) { await delay(800); if (await ev("!!document.querySelector('[data-start-mode]')")) break; }
await delay(1500);

const entries = await ev(`(() => {
  const nodes = [...document.querySelectorAll('[data-start-mode]')];
  return nodes.map((n) => ({
    mode: n.dataset.startMode,
    label: n.getAttribute('title'),
    img: n.querySelector('img')?.getAttribute('src'),
    loaded: (n.querySelector('img')?.naturalWidth ?? 0) > 0,
  }));
})()`);
check('四个入口都在', Array.isArray(entries) && entries.length === 4, `${entries?.length} 个`);
check('入口顺序是图/视频/音乐/分析',
  JSON.stringify((entries ?? []).map((e) => e.mode)) === JSON.stringify(['image', 'video', 'audio', 'analysis']),
  JSON.stringify((entries ?? []).map((e) => e.mode)));
check('四张图都加载成功', (entries ?? []).every((e) => e.loaded) === true, JSON.stringify((entries ?? []).map((e) => e.loaded)));
check('指向新的图片文件', (entries ?? []).every((e) => /create-thumb-(image|video|audio|analysis)\.webp/.test(e.img ?? '')) === true, (entries ?? [])[0]?.img ?? '');
check('标签是中文功能名',
  JSON.stringify((entries ?? []).map((e) => e.label)) === JSON.stringify(['图片生成', '视频生成', '音乐生成', '素材分析']),
  JSON.stringify((entries ?? []).map((e) => e.label)));

const copy = await ev(`(() => {
  const text = document.body.innerText || '';
  return {
    heading: text.includes('从这里开始'),
    english: /Create Here|Imagine the scene/.test(text),
    sub: text.includes('选一个入口'),
    caption: text.includes('四个入口'),
  };
})()`);
check('标题改成中文「从这里开始」', copy?.heading === true);
check('没有残留英文标题', copy?.english === false);
check('副标题也是中文', copy?.sub === true);
check('说明提到四个入口', copy?.caption === true);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'entries-studio.png', Buffer.from(shot.data, 'base64'));

// 读底部输入框左上角的模式按钮，这才是「真的切了」
const mediaLabel = () =>
  ev(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => ['图片', '视频', '音乐', '分析'].includes((b.textContent || '').trim()));
    return btn ? (btn.textContent || '').trim() : null;
  })()`);

check('默认是图片模式', (await mediaLabel()) === '图片', String(await mediaLabel()));

await ev(`document.querySelector('[data-start-mode="audio"]')?.click()`);
await delay(2000);
const audioState = await ev(`(() => {
  const selected = [...document.querySelectorAll('[aria-pressed="true"]')].length;
  return { selected };
})()`);
check('点音乐后卡片进入选中态', (audioState?.selected ?? 0) >= 1, `${audioState?.selected} 个`);
check('点音乐后真的切到音乐模式', (await mediaLabel()) === '音乐', String(await mediaLabel()));

await ev(`document.querySelector('[data-start-mode="video"]')?.click()`);
await delay(2000);
check('点视频后真的切到视频模式', (await mediaLabel()) === '视频', String(await mediaLabel()));

// ── B. 画布空状态 ───────────────────────────────────────
const canvas = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '入口验证-画布', workspaceMode: 'canvas' }) })).json();
await send('Page.navigate', { url: `${APP}/zh/canvas/${canvas.id}` });
for (let i = 0; i < 30; i++) { await delay(800); if (await ev("!!document.querySelector('[data-start-mode]')")) break; }
await delay(2000);

const canvasStart = await ev(`(() => ({
  own: !!document.querySelector('[data-beatcanvas-start]'),
  actions: document.querySelectorAll('[data-canvas-start-action]').length,
  studioEntries: document.querySelectorAll('[data-start-mode]').length,
}))()`);
check('画布有自己的空状态', canvasStart?.own === true);
check('画布给出三张卡', canvasStart?.actions === 3, `${canvasStart?.actions} 个`);
check('画布不再复用创作台入口', canvasStart?.studioEntries === 0, `${canvasStart?.studioEntries} 个`);

// 点「图片生成」→ 应该开出一张草稿卡
await ev(`document.querySelector('[data-canvas-start-action="image"]')?.click()`);
await delay(2500);
const afterDraft = await ev(`(() => {
  const text = document.body.innerText || '';
  return { entriesGone: document.querySelectorAll('[data-canvas-start-action]').length === 0, hasComposer: /生成|提示词/.test(text) };
})()`);
check('点图片后开出草稿卡', afterDraft?.entriesGone === true, `入口剩余 ${await ev("document.querySelectorAll('[data-start-mode]').length")}`);

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'entries-canvas.png', Buffer.from(shot2.data, 'base64'));

await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [studio.id, canvas.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

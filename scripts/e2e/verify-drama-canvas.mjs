// AI 短剧画布：创建两个模式 → 短剧画布结构 → 剧本→分镜→资产→分段→最终台
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
    if (!/Project not found/.test(text)) errors.push(text.slice(0, 180));
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
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

// ---------- 1) 两种模式并存 ----------
console.log('\n=== 模式选择 ===');
await send('Page.navigate', { url: `${APP}/zh/canvas` });
await delay(5000);
const bodyText = await ev('document.body.innerText');
check('创建页有「基本画布」', bodyText.includes('基本画布'));
check('创建页有「AI 短剧模式」', bodyText.includes('AI 短剧模式'));

// ---------- 2) 建一个短剧项目 ----------
console.log('\n=== 短剧项目 ===');
const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '短剧验证', workspaceMode: 'canvas' }),
})).json();
const emptyDrama = JSON.stringify({ version: 1, script: '', publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle' });
// Projects ship with an initial empty snapshot, so negotiate the version.
const current = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const putRes = await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({ document: { version: 3, canvasKind: 'drama', cards: [], frames: {}, drama: emptyDrama }, baseVersion: current?.version ?? null }),
});
check('快照写入成功', putRes.status === 200, 'HTTP ' + putRes.status);

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) {
  await delay(900);
  if (await ev("!!document.querySelector('textarea')")) break;
}
await delay(2500);

const text = await ev('document.body.innerText');
check('打开的是短剧画布', text.includes('剧本') && text.includes('分镜台'), '');
check('有公共资产图节点', text.includes('公共资产图'));
check('有最终视频台节点', text.includes('最终视频台'));
check('不是基本画布', !(await ev("!!document.querySelector('.beatcanvas-react-flow')")));

// ---------- 3) 剧本 → 分镜 → 分段 ----------
console.log('\n=== 剧本 → 分镜 ===');
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('套用模板'));
  b?.click();
})()`);
await delay(1200);
check('模板已填入剧本', (await ev("!!document.querySelector('textarea')?.value?.includes('【人物】')")) === true);

await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台'));
  b?.click();
})()`);
await delay(2500);

const afterSplit = await ev('document.body.innerText');
const workbenches = (afterSplit.match(/分段工作台 \d+/g) ?? []).length;
check('生成了分段工作台', workbenches >= 2, `${workbenches} 个`);
check('公共资产有内容', (afterSplit.match(/用于 \d+ 段/g) ?? []).length >= 1);

// 勾选公共资产到第一段
// 分段卡片里的素材芯片就是用资产名字做的按钮
const assetNames = await ev(`(() => {
  const texts = [...document.querySelectorAll('span')].map(s => (s.textContent||'').trim());
  return texts.filter(x => /^[人景道] · /.test(x)).map(x => x.replace(/^[人景道] · /, ''));
})()`);
const toggled = await ev(`(() => {
  const names = ${JSON.stringify(['阿明', '角色1', '场景1', '道具1'])};
  const chips = [...document.querySelectorAll('button')].filter(b => names.includes((b.textContent||'').trim()));
  if (!chips.length) return 0;
  chips[0].click();
  return chips.length;
})()`);
await delay(1200);
check('分段能挂公共资产', toggled >= 1, `${toggled} 个可选芯片`);
// 计数只算真的有图的资产：刚挂的资产还没换图，所以必须仍是 0 —— 之前这里
// 显示「1 张」但提交时一张都没发，属于谎报。
const refText = await ev("document.body.innerText");
check('没图的资产不计入参考图', refText.includes('参考图 0 张'), (refText.match(/参考图 \d+ 张/g) ?? []).join(','));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-canvas.png', Buffer.from(shot.data, 'base64'));

// ---------- 4) 持久化 ----------
console.log('\n=== 持久化 ===');
await delay(2000);
const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
check('快照记录了 canvasKind', saved.document?.canvasKind === 'drama', String(saved.document?.canvasKind));
const drama = JSON.parse(saved.document?.drama ?? '{}');
check('快照记录了分段', Array.isArray(drama.shots) && drama.shots.length >= 2, `${drama.shots?.length} 段`);
check('快照记录了公共资产', Array.isArray(drama.publicAssets) && drama.publicAssets.length >= 1, `${drama.publicAssets?.length} 个`);
check('快照记录了资产挂载', (drama.shots ?? []).some((s) => (s.publicAssetIds ?? []).length > 0));

// 重新打开应恢复
await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2000);
const reopened = await ev('document.body.innerText');
check('重新打开仍在短剧模式', reopened.includes('分镜台') && reopened.includes('分段工作台'));
check('重新打开恢复了分段', (reopened.match(/分段工作台 \d+/g) ?? []).length >= 2);

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

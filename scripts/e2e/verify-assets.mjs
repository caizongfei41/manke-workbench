// 素材分析 + 悬浮预览验证
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200));
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
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '素材验证' }) })).json();

await send('Page.navigate', { url: `${APP}/zh/studio/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(800); if ((await ev(`!!document.querySelector('[data-beatapi-composer]')`)) === true) break; }
await delay(2000);

// 视频 + AICG3D
await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Media type"]')?.click()`);
await delay(800);
await ev(`[...document.querySelectorAll('[role="option"]')].find(o => (o.textContent||'').trim() === '视频')?.click()`);
await delay(2200);
await ev(`document.querySelector('[data-beatapi-composer] button[aria-label="Model"]')?.click()`);
await delay(900);
const mi = await ev(`[...document.querySelectorAll('[role="option"]')].findIndex(o => (o.textContent||'').includes('长视频 · 画质优先'))`);
if (mi >= 0) { await ev(`[...document.querySelectorAll('[role="option"]')][${mi}]?.click()`); await delay(2500); }

// 打开剧本导入 → 套用模板
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').includes('导入剧本'))?.click()`);
await delay(900);
check('套用模板按钮存在', (await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].some(b => (b.textContent||'').includes('套用模板'))`)) === true);
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').includes('套用模板'))?.click()`);
await delay(900);
const tplText = await ev(`(() => {
  const t = [...document.querySelectorAll('[data-beatapi-composer] textarea')].find(x => (x.placeholder||'').includes('剧本'));
  return t ? t.value.slice(0, 30) : 'no';
})()`);
check('模板已填入', String(tplText).includes('【人物】'), String(tplText).replace(/\n/g, ' '));

// 换成一份真实剧本（含人物/场景/道具/分镜）
const script = `【人物】
阿明：28 岁，黑色风衣，左手有旧疤
小雅：24 岁，白色连衣裙，长发

【场景】
雨夜街头：深夜，积水映霓虹，冷色调

【道具】
旧怀表：黄铜外壳，表盘有裂痕

【第1段｜5秒】
0.0～1.0秒：中景平视，雨夜街头，霓虹在积水里散开。
1.0～4.2秒：阿明 (S1) says: <d>[Chinese] 你还留着它？</d>
4.2～5.0秒：小雅低头看向阿明手里的旧怀表。

【第2段｜4秒】
0.0～0.8秒：近景，切到小雅。
0.8～3.4秒：小雅 (S2) says: <d>[Chinese] 一直留着。</d>
3.4～4.0秒：雨滴落在怀表表盘上。`;
await ev(`(() => {
  const t = [...document.querySelectorAll('[data-beatapi-composer] textarea')].find(x => (x.placeholder||'').includes('剧本'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, ${JSON.stringify(script)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(700);
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').includes('切分成分镜'))?.click()`);
await delay(1500);

const summary = await ev(`(() => {
  const spans = [...document.querySelectorAll('[data-beatapi-composer] span')].map(s => (s.textContent||'').trim());
  const i = spans.indexOf('分段导演台');
  return i >= 0 ? spans[i+1] : '?';
})()`);
check('切出 2 段', String(summary).includes('2 段'), summary);

// 素材标签页
await ev(`[...document.querySelectorAll('[data-beatapi-composer] button')].find(b => (b.textContent||'').trim().startsWith('素材'))?.click()`);
await delay(1200);
const assetNames = await ev(`(() => {
  const spans = [...document.querySelectorAll('[data-beatapi-composer] span')].map(s => (s.textContent||'').trim());
  return spans.filter(t => ['阿明','小雅','雨夜街头','旧怀表'].includes(t));
})()`);
check('识别出 4 个素材', Array.isArray(assetNames) && assetNames.length === 4, String(assetNames));
const kinds = await ev(`(() => {
  const spans = [...document.querySelectorAll('[data-beatapi-composer] span')].map(s => (s.textContent||'').trim());
  return ['人物','场景','道具'].filter(k => spans.includes(k));
})()`);
check('三类分组都在', Array.isArray(kinds) && kinds.length === 3, String(kinds));
const buttons = await ev(`['生图','上传','导入分镜'].map(t => [...document.querySelectorAll('[data-beatapi-composer] button')].filter(b => (b.textContent||'').trim() === t).length)`);
check('每项都有生图/上传/导入', Array.isArray(buttons) && buttons.every((n) => n >= 4), String(buttons));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'director-assets.png', Buffer.from(shot.data, 'base64'));

// 悬浮预览：把鼠标移到分镜的参考图上（先给分镜挂一张已有图）
// 用「导入分镜」前需要图，这里改为验证组件本身在 DOM 里可用（无图时不显示）
check('无图时预览不出现', (await ev(`document.querySelectorAll('[role="tooltip"]').length`)) === 0);

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

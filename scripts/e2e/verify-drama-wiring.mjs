// 接线交互 + 资产随剧本更新
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
// Chromium throttles background tabs, which stops requestAnimationFrame and
// leaves the board unmeasured. Make this tab the active one.
await send('Page.bringToFront');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '接线验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: { version: 3, canvasKind: 'drama', cards: [], frames: {}, drama: JSON.stringify({ version: 1, script: '', positions: {}, links: [], publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle' }) },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);
// Wait for the board to be measured. A busy tab can take a moment before
// requestAnimationFrame runs and the node rects exist; asserting earlier makes
// this look like a broken feature instead of a slow frame.
for (let attempt = 0; attempt < 20; attempt += 1) {
  const ready = await ev("document.querySelectorAll('svg path[marker-end]').length > 0");
  if (ready === true) break;
  await delay(500);
}

const scriptA = `【人物】
阿明：28 岁，黑色风衣

【场景】
雨夜街头：深夜，冷色调

【第1段｜3秒】
中景，雨夜街头，阿明走过。

【第2段｜3秒】
近景，阿明抬头看雨。`;
const scriptB = `【人物】
阿明：28 岁，黑色风衣
小雅：24 岁，白色连衣裙

【场景】
天台：黄昏，暖色调

【道具】
旧怀表：黄铜外壳

【第1段｜3秒】
中景，天台，阿明和小雅并肩。

【第2段｜3秒】
近景，旧怀表在手中。`;

const setScript = async (text) => {
  await ev(`(() => {
    const t = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, ${JSON.stringify(text)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(600);
};

// ---------- 1) 资产随剧本更新 ----------
console.log('\n=== 资产随剧本更新 ===');
await setScript(scriptA);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台')); b?.click(); })()`);
await delay(2200);
const afterA = await ev(`(() => {
  const spans = [...document.querySelectorAll('span')].map(s => (s.textContent||'').trim());
  return spans.filter(x => /^[人场道] · /.test(x)).map(x => x.replace(/^[人场道] · /, ''));
})()`);
check('第一次切分出 2 个资产', Array.isArray(afterA) && afterA.length === 2, String(afterA));

await setScript(scriptB);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台')); b?.click(); })()`);
await delay(2200);
const afterB = await ev(`(() => {
  const spans = [...document.querySelectorAll('span')].map(s => (s.textContent||'').trim());
  return spans.filter(x => /^[人场道] · /.test(x)).map(x => x.replace(/^[人场道] · /, ''));
})()`);
check('剧本改了资产跟着变', Array.isArray(afterB) && afterB.length === 4, String(afterB));
check('新增的小雅出现', String(afterB).includes('小雅'));
check('新增的旧怀表出现', String(afterB).includes('旧怀表'));
check('消失的雨夜街头被移除', !String(afterB).includes('雨夜街头'));

// ---------- 2) 接线：默认 6 条 ----------
console.log('\n=== 接线 ===');
// 等连线真的画出来：节点尺寸靠 requestAnimationFrame 量，量到之前只有阶段间那两条
for (let attempt = 0; attempt < 25; attempt += 1) {
  const drawn = await ev("document.querySelectorAll('svg path[marker-end]').length");
  if (drawn >= 6) break;
  await delay(400);
}

const linkCount = () => ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find(s => s.querySelector('#drama-arrow'));
  return svg ? [...svg.querySelectorAll('path')].filter(p => p.getAttribute('marker-end')).length : 0;
})()`);
check('默认接线 6 条（2 段 × 2 + 2）', (await linkCount()) === 6, String(await linkCount()));

const ports = await ev(`(() => ({
  inputs: document.querySelectorAll('[data-drama-input-port]').length,
  dragHint: [...document.querySelectorAll('span')].filter(s => (s.getAttribute('title')||'').includes('拖出')).length,
}))()`);
check('每段都有输入端口', ports.inputs >= 2, `${ports.inputs} 个`);
check('输出端口可拖线', ports.dragHint >= 2, `${ports.dragHint} 个`);

// 断开「公共资产 → 分段工作台 1」：从资产节点的输出端口拖到该段的输入端口
// 分步派发：pointerdown 之后 React 才有机会挂上 window 监听
const pt = await ev(`(() => {
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')];
  const shotHead = heads.find(h => (h.textContent||'').includes('分段工作台 1'));
  const assetHead = heads.find(h => (h.textContent||'').includes('公共资产图'));
  if (!shotHead || !assetHead) return null;
  const scopeOf = (head) => head.parentElement.parentElement;
  const out = [...scopeOf(assetHead).querySelectorAll('span[title]')]
    .find(s => (s.getAttribute('title')||'').includes('拖出'));
  const input = scopeOf(shotHead).querySelector('[data-drama-input-port]');
  if (!out || !input) return null;
  const o = out.getBoundingClientRect();
  const i = input.getBoundingClientRect();
  out.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: o.left + 4, clientY: o.top + 4 }));
  return { ox: o.left + 4, oy: o.top + 4, ix: i.left + 4, iy: i.top + 4 };
})()`);
check('输出端口可发起连线', !!pt, JSON.stringify(pt));

let cut = 'skipped';
if (pt) {
  await delay(400);
  await ev(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: ${pt.ix}, clientY: ${pt.iy} }))`);
  await delay(300);
  cut = await ev(`(() => {
    const input = [...document.querySelectorAll('[data-drama-input-port]')]
      .find(p => {
        const head = p.closest('div')?.parentElement;
        return true;
      });
    // 用落点坐标找端口，避免选到别的
    const target = document.elementFromPoint(${pt.ix}, ${pt.iy})?.closest('[data-drama-input-port]');
    if (!target) return 'no-target';
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: ${pt.ix}, clientY: ${pt.iy} }));
    return 'ok';
  })()`);
  await delay(1500);
}
console.log('  断线操作:', cut);

const afterCut = await linkCount();
check('拖线到输入端口会断开已有连接', afterCut === 5, `${afterCut} 条`);
check('该段显示已断开提示', (await ev('document.body.innerText')).includes('已断开公共资产'));

// 自动接线恢复
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '自动接线'); b?.click(); })()`);
await delay(1200);
check('自动接线恢复 6 条', (await linkCount()) === 6, String(await linkCount()));
check('断开提示消失', !(await ev('document.body.innerText')).includes('已断开公共资产'));

// 持久化
await delay(2000);
const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(saved.document?.drama ?? '{}');
check('接线写进快照', Array.isArray(drama.links) && drama.links.length === 6, `${drama.links?.length} 条`);
check('资产随剧本写进快照', (drama.publicAssets ?? []).length === 4, `${drama.publicAssets?.length} 个`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-wiring.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

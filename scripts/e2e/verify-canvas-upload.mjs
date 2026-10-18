// 画布：素材上传真实落盘 + 导入分镜 + 该段拿到参考图
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;
const TEST_IMAGE = OUT + 'test-upload.png';

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
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '画布上传' }) })).json();

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) {
  await delay(900);
  if ((await ev("!!document.querySelector('.beatcanvas-react-flow')")) === true) break;
}
await delay(3000);

await ev(`(() => {
  const rail = [...document.querySelectorAll('div')].find(d => {
    const r = d.getBoundingClientRect();
    return r.width < 70 && r.height > 120 && r.left < 100;
  });
  rail?.querySelector('button')?.click();
})()`);
await delay(2500);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 580, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 580, button: 'left', clickCount: 1 });
await delay(2500);

// 切视频 + AICG3D
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').trim()==='图片'); b?.click(); })()`);
await delay(1200);
await ev(`(() => {
  const o = [...document.querySelectorAll('button, div')].find(x => (x.textContent||'').trim()==='视频' && x.getBoundingClientRect().height > 20);
  o?.click();
})()`);
await delay(2200);
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('MiniMax') || (x.textContent||'').includes('长视频'));
  b?.click();
})()`);
await delay(1200);
await ev(`(() => {
  const o = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim().includes('长视频 · 480P'));
  o?.click();
})()`);
await delay(2500);

// 导入剧本（带人物），切分
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('导入剧本')); b?.click(); })()`);
await delay(900);
const script = `【人物】\n阿明：28 岁，黑色风衣\n\n【第1段｜3秒】\n0.0～1.0秒：中景，雨夜街头。\n1.0～2.6秒：阿明 (S1) says: <d>[Chinese] 你还留着它？</d>\n\n【第2段｜3秒】\n0.0～1.0秒：近景，雨滴落下。\n1.0～2.6秒：阿明抬头。`;
await ev(`(() => {
  const t = [...document.querySelectorAll('textarea')].find(x => (x.placeholder||'').includes('剧本'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, ${JSON.stringify(script)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(700);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('切分成分镜')); b?.click(); })()`);
await delay(1500);

// 素材页，点第一个「上传」
await ev("[...document.querySelectorAll('button')].find(b => (b.textContent||'').trim().startsWith('素材'))?.click()");
await delay(1000);
check('素材页有上传按钮', (await ev("[...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim()==='上传').length")) >= 1);

await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '上传');
  b?.click();
})()`);
await delay(800);

// 找到那个隐藏的 file input 并塞文件
const doc = await send('DOM.getDocument', { depth: -1 });
// 只认导演台面板里的那个 input，画布自己还有几个上传入口
const search = await send('DOM.querySelectorAll', {
  nodeId: doc.root.nodeId,
  selector: '[data-composer-panel] input[type=file]',
});
const nodeIds = search.nodeIds ?? [];
console.log('  导演台里的 file input:', nodeIds.length);
let uploaded = false;
if (nodeIds[0]) {
  await send('DOM.setFileInputFiles', { files: [TEST_IMAGE], nodeId: nodeIds[0] });
  await delay(5000);
  uploaded = true;
}
check('上传文件已提交', uploaded);

// 素材卡片应拿到图
let hasThumb = false;
for (let i = 0; i < 10; i++) {
  await delay(1500);
  hasThumb = (await ev(`(() => {
    const rows = [...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim() === '生图');
    return rows.some(r => {
      const row = r.closest('div.flex.items-center');
      return !!row?.querySelector('img');
    });
  })()`)) === true;
  if (hasThumb) break;
}
check('素材卡片出现了上传的图', hasThumb);

// 导入到分镜
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '导入分镜');
  b?.click();
})()`);
await delay(1500);
await ev("[...document.querySelectorAll('button')].find(b => (b.textContent||'').trim().startsWith('分镜'))?.click()");
await delay(1200);
const shotImgs = await ev(`(() => {
  const segs = [...document.querySelectorAll('span.relative')];
  return segs.filter(s => s.querySelector('img')).length;
})()`);
check('分镜拿到了参考图', shotImgs > 0, `${shotImgs} 段`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'canvas-upload.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

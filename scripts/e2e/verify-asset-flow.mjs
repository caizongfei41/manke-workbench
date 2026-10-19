// 素材链路：生图 → 自动回挂 → 悬浮预览 → 导入分镜
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
    errors.push(String(m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200));
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
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '素材链路' }) })).json();

await send('Page.navigate', { url: `${APP}/zh/studio/${proj.id}` });
for (let i = 0; i < 30; i++) {
  await delay(800);
  if ((await ev("!!document.querySelector('[data-beatapi-composer]')")) === true) break;
}
await delay(2000);

const clickText = (text, exact) =>
  ev(
    `(() => {
      const b = [...document.querySelectorAll('[data-beatapi-composer] button')]
        .find(x => ${exact ? `(x.textContent||'').trim() === ${JSON.stringify(text)}` : `(x.textContent||'').includes(${JSON.stringify(text)})`});
      if (!b) return 'missing';
      b.click();
      return 'ok';
    })()`
  );

await ev("document.querySelector('[data-beatapi-composer] button[aria-label=\"Media type\"]')?.click()");
await delay(800);
await ev("[...document.querySelectorAll('[role=\"option\"]')].find(o => (o.textContent||'').trim() === '视频')?.click()");
await delay(2200);
await ev("document.querySelector('[data-beatapi-composer] button[aria-label=\"Model\"]')?.click()");
await delay(900);
const mi = await ev("[...document.querySelectorAll('[role=\"option\"]')].findIndex(o => (o.textContent||'').includes('长视频 · 画质优先'))");
if (mi >= 0) {
  await ev(`[...document.querySelectorAll('[role="option"]')][${mi}]?.click()`);
  await delay(2500);
}

const script = `【人物】
阿明：28 岁，黑色风衣

【第1段｜5秒】
0.0～1.0秒：中景，雨夜街头。
1.0～4.2秒：阿明 (S1) says: <d>[Chinese] 你还留着它？</d>`;
await clickText('导入剧本', false);
await delay(900);
await ev(
  `(() => {
    const t = [...document.querySelectorAll('[data-beatapi-composer] textarea')].find(x => (x.placeholder||'').includes('剧本'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, ${JSON.stringify(script)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`
);
await delay(600);
await clickText('切分成分镜', false);
await delay(1500);
await clickText('素材', false);
await delay(1000);

await ev(
  `(() => {
    const rows = [...document.querySelectorAll('[data-beatapi-composer] button')].filter(b => (b.textContent||'').trim() === '生图');
    rows[0]?.click();
  })()`
);
await delay(2500);
const mediaNow = await ev("document.querySelector('[data-beatapi-composer] button[aria-label=\"Media type\"]')?.textContent?.trim()");
check('生图切到图片模式', String(mediaNow).includes('图片'), String(mediaNow));

await ev("document.querySelector('[data-beatapi-composer] button[aria-label=\"Model\"]')?.click()");
await delay(900);
const m4 = await ev("[...document.querySelectorAll('[role=\"option\"]')].findIndex(o => (o.textContent||'').includes('文生图 4 步加速'))");
if (m4 >= 0) {
  await ev(`[...document.querySelectorAll('[role="option"]')][${m4}]?.click()`);
  await delay(1800);
}
const promptNow = await ev("document.querySelector('[data-beatapi-composer] textarea')?.value ?? ''");
check('提示词带上了素材描述', String(promptNow).includes('阿明'), String(promptNow).slice(0, 40));

await ev(
  `(() => {
    const b = [...document.querySelectorAll('[data-beatapi-composer] button')];
    b[b.length - 1].click();
  })()`
);
console.log('  已提交生成，等待结果…');

let succeeded = false;
for (let i = 0; i < 60; i++) {
  await delay(3000);
  const gens = await (
    await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })
  ).json();
  const items = gens.items ?? [];
  succeeded = items.some((it) => it.status === 'succeeded' && it.resultUrl);
  console.log(
    `    [${(i + 1) * 3}s] ${items.length} 条: ` +
      items.map((x) => `${x.status}/${x.mediaType}`).join(',')
  );
  if (succeeded) break;
}
check('图片生成成功', succeeded);

// 生成结束后自动回到视频模式，导演台应该重新出现
let returned = false;
for (let i = 0; i < 60; i++) {
  await delay(1500);
  const media = await ev(
    "document.querySelector('[data-beatapi-composer] button[aria-label=\"Media type\"]')?.textContent?.trim()"
  );
  const panel = await ev(
    "[...document.querySelectorAll('[data-beatapi-composer] span')].some(s => (s.textContent||'').trim() === '分段导演台')"
  );
  if (String(media).includes('视频') && panel === true) { returned = true; break; }
}
check('生成后自动回到导演台', returned);

await clickText('素材', false);
await delay(1200);

const assetThumbs = await ev(`(() => {
  const rows = [...document.querySelectorAll('[data-beatapi-composer] button')].filter(b => (b.textContent||'').trim() === '生图');
  return rows
    .map((r) => {
      const row = r.closest('div.flex.items-center');
      const img = row ? row.querySelector('img') : null;
      return img ? img.src : null;
    })
    .filter(Boolean);
})()`);
const attached = Array.isArray(assetThumbs) && assetThumbs.length > 0;
check('素材卡片出现了图', attached, attached ? String(assetThumbs[0]).slice(0, 60) : '无');

if (attached) {
  const box = await ev(`(() => {
    const rows = [...document.querySelectorAll('[data-beatapi-composer] button')].filter(b => (b.textContent||'').trim() === '生图');
    const row = rows[0] ? rows[0].closest('div.flex.items-center') : null;
    const img = row ? row.querySelector('img') : null;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);

  if (box) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await delay(1000);
    const tip = await ev(`(() => {
      const t = [...document.querySelectorAll('[role="tooltip"]')].find(x => x.querySelector('img'));
      return t ? t.getBoundingClientRect().width : 0;
    })()`);
    check('悬浮预览出现并放大', tip >= 200, `${tip}px 宽`);
    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(OUT + 'asset-hover.png', Buffer.from(shot1.data, 'base64'));

    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await delay(600);
    const gone = await ev("[...document.querySelectorAll('[role=\"tooltip\"]')].filter(x => x.querySelector('img')).length");
    check('移开后预览消失', gone === 0);
  }

  await clickText('导入分镜', true);
  await delay(1200);
  await clickText('分镜', false);
  await delay(1000);
  const shotImgs = await ev(`(() => {
    const segs = [...document.querySelectorAll('[data-beatapi-composer] span.relative')];
    return segs.filter((s) => s.querySelector('img')).length;
  })()`);
  check('分镜拿到了参考图', shotImgs > 0, `${shotImgs} 段有图`);
  const final = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + 'asset-imported.png', Buffer.from(final.data, 'base64'));
}

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

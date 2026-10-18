// 对比度巡检：文字与它实际背景的亮度差，抓「黑底黑字」这类问题
// 阈值取得保守（1.5）：淡字是设计选择，但同色 = 看不见，必须红。
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const MIN_CONTRAST = 1.5;

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
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (!m.id) return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
});
const send = (method, params = {}) => {
  const n = ++seq;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((res, rej) => {
    pending.set(n, { resolve: res, reject: rej });
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 90000);
  });
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description ?? '').slice(0, 200);
  return r.result.value;
};

// 页面内测量：用 canvas 解析颜色（oklab / color-mix 都能吃），再算 WCAG 对比度
const MEASURE = `(() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  // 把任意颜色画到给定底色上，读回真实 RGB
  const flatten = (color, base) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // 同一个颜色叠在黑底和白底上，结果一样就说明它不透明
  const isOpaque = (color) => {
    const onBlack = flatten(color, 'rgb(0,0,0)').join(',');
    const onWhite = flatten(color, 'rgb(255,255,255)').join(',');
    return onBlack === onWhite;
  };

  // 找元素背后真正的底色：向上找第一个不透明的背景
  const backgroundOf = (el) => {
    let node = el;
    let layers = [];
    // 必须一路走到 html：主题背景挂在 html/body 上，提前停会把它当成白底
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // 图片背景，跳过
      const bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        layers.push(bg);
        // 用画布判断是否不透明：oklab 里的 /0.1 用正则认不出来
        if (isOpaque(bg)) break;
      }
      node = node.parentElement;
    }
    // 从最深的一层往上叠；最底下垫的是 html 的实际背景
    const rootBg = getComputedStyle(document.documentElement).backgroundColor;
    const rootOpaque = rootBg && rootBg !== 'rgba(0, 0, 0, 0)' && rootBg !== 'transparent';
    let base = rootOpaque ? 'rgb(' + flatten(rootBg, 'rgb(255,255,255)').join(',') + ')' : 'rgb(255,255,255)';
    for (let i = layers.length - 1; i >= 0; i -= 1) base = 'rgb(' + flatten(layers[i], base).join(',') + ')';
    return base;
  };

  const out = [];
  const nodes = document.querySelectorAll('body *');
  for (const el of nodes) {
    const text = (el.childNodes.length ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('') : '');
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;

    const base = backgroundOf(el);
    if (!base) continue;
    // 解析不了就跳过，而不是当成「等于底色」误报 1.0
    const probe = (color) => {
      ctx.fillStyle = 'rgb(1,2,3)';
      ctx.fillStyle = color;
      return ctx.fillStyle !== 'rgb(1,2,3)';
    };
    if (!probe(cs.color)) continue;
    const fg = flatten(cs.color, base);
    const bg = base.match(/[0-9]+/g).map(Number);
    out.push({
      text: text.slice(0, 24),
      ratio: Number(ratio(fg, bg).toFixed(2)),
      color: cs.color,
      bg: base,
    });
  }
  out.sort((a, b) => a.ratio - b.ratio);
  return { total: out.length, worst: out.slice(0, 8) };
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

const create = async (name, mode) =>
  (await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name, workspaceMode: mode }) })).json()).id;

const studioId = await create('对比度-工作台', 'studio');
const canvasId = await create('对比度-画布', 'canvas');
const editorId = await create('对比度-剪辑', 'editor');
const dramaId = await create('对比度-短剧', 'canvas');
const cur = await (await fetch(`${APP}/api/app/projects/${dramaId}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${dramaId}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: {}, loras: [], subtitles: true, exportPreset: 'vertical',
        enhance: { enabled: false, rules: [], extra: '' },
        bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

const pages = [
  ['首页', '/zh'],
  ['项目列表', '/zh/projects'],
  ['工作台', `/zh/studio/${studioId}`],
  ['画布', `/zh/canvas/${canvasId}`],
  ['短剧画布', `/zh/canvas/${dramaId}`],
  ['剪辑', `/zh/editor/${editorId}`],
  ['素材', '/zh/assets'],
  ['服务', '/zh/services'],
];

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name + (detail ? '  ' + detail : '')); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

const report = [];

for (const theme of ['light', 'dark']) {
  // 只写 localStorage 不够：不 reload 的话 html 换了、body 还没跟上，量出来是混合态
  await ev(`localStorage.setItem('manke-theme','${theme}')`);
  // 用带时间戳的地址强制一次新的文档加载；Page.reload 会让 CDP 目标脱离
  await send('Page.navigate', { url: `${APP}/zh?theme-check=${Date.now()}` });
  let applied = null;
  for (let i = 0; i < 15; i += 1) {
    await delay(500);
    applied = await ev('document.documentElement.dataset.theme');
    if (applied === theme) break;
  }
  check(`${theme} 主题已生效`, applied === theme, String(applied));
  console.log(`\n=== ${theme} ===`);
  for (const [label, path] of pages) {
    await send('Page.navigate', { url: `${APP}${path}` });
    await delay(3200);
    const result = await ev(MEASURE);
    if (typeof result === 'string') { check(`${label} 可测量`, false, result); continue; }
    const worst = result.worst?.[0];
    report.push({ theme, label, worst });
    check(
      `${label}：最差对比度 ${worst?.ratio ?? '-'}（${result.total} 段文字）`,
      (worst?.ratio ?? 99) >= MIN_CONTRAST,
      worst ? `「${worst.text}」 ${worst.color} on ${worst.bg}` : ''
    );
  }
}

writeFileSync(OUT + 'contrast-report.json', JSON.stringify(report, null, 2), 'utf8');

await fetch(`${APP}/api/app/projects`, {
  method: 'DELETE', headers: H,
  body: JSON.stringify({ projectIds: [studioId, canvasId, editorId, dramaId] }),
});

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length}（阈值 ${MIN_CONTRAST}） ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
console.log('  明细: contrast-report.json');
ws.close();
process.exit(fails.length ? 1 : 0);

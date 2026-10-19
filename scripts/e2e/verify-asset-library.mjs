// 全局素材库：跨项目汇总、按类型/项目筛选、搜索、预览、项目归属
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// 真数据：接口本身返回什么
const api = await (await fetch(`${APP}/api/app/recent-assets?limit=120`, { headers: { origin: APP } })).json();
const total = (api.images?.length ?? 0) + (api.videos?.length ?? 0) + (api.audios?.length ?? 0);
check('接口返回三类素材', total > 0, `图 ${api.images?.length} 视频 ${api.videos?.length} 音频 ${api.audios?.length}`);
check(
  '素材带项目归属',
  [...(api.images ?? []), ...(api.videos ?? [])].every((a) => 'projectName' in a),
  `样例 ${api.images?.[0]?.projectName ?? '—'}`
);

// 打开素材库
await send('Page.navigate', { url: `${APP}/zh/assets?t=${Date.now()}` });
for (let i = 0; i < 45; i += 1) {
  await delay(700);
  if (await ev("document.querySelectorAll('[data-library-asset]').length > 0")) break;
}
await delay(1500);

const tiles = () => ev(`document.querySelectorAll('[data-library-asset]').length`);
const shown = await tiles();
check('素材库渲染出素材', shown > 0, `${shown} 个`);
check('导航里出现了素材入口', (await ev(`[...document.querySelectorAll('a')].some((a) => (a.getAttribute('href') || '').endsWith('/assets'))`)) === true);

// 1. 按类型筛选
await ev(`document.querySelector('[data-library-kind="video"]')?.click()`);
await delay(900);
const videoOnly = await tiles();
const expectedVideos = Math.min(api.videos?.length ?? 0, 120);
check('筛到视频', videoOnly > 0 && videoOnly <= Math.max(expectedVideos, 1), `${videoOnly} 个（接口 ${expectedVideos}）`);
const allImages = await ev(`[...document.querySelectorAll('[data-library-asset] img')].length`);
check('视频筛选下没有图片瓦片', allImages === 0, `${allImages} 张图`);

await ev(`document.querySelector('[data-library-kind="audio"]')?.click()`);
await delay(900);
const audioOnly = await tiles();
check('筛到音频', audioOnly >= 0 && audioOnly <= Math.max(api.audios?.length ?? 0, 1), `${audioOnly} 个`);

// 1.5 视频瓦片：有画面，或者明确说「无法预览」，不能两者都不是
await send('Page.bringToFront');
await delay(1200);
await ev(`document.querySelector('[data-library-kind="video"]')?.click()`);
await delay(9000);
const videoState = await ev(`(() => {
  const tiles = [...document.querySelectorAll('[data-library-asset]')];
  const vids = tiles.map((t) => t.querySelector('video')).filter(Boolean);
  return {
    tiles: tiles.length,
    painted: vids.filter((v) => v.videoWidth > 0).length,
    broken: tiles.filter((t) => t.querySelector('[data-library-broken]')).length,
    ambiguous: tiles.filter((t) => !t.querySelector('video') && !t.querySelector('[data-library-broken]')).length,
  };
})()`);
check(
  '视频瓦片都有明确状态',
  videoState.ambiguous === 0,
  `有画面 ${videoState.painted} / 标注无法预览 ${videoState.broken} / 含糊 ${videoState.ambiguous}`
);
check('至少有一段视频真的解出了画面', videoState.painted > 0, `${videoState.painted} 段`);

// 2. 搜索
await ev(`document.querySelector('[data-library-kind="all"]')?.click()`);
await delay(600);
await ev(`(() => {
  const input = document.querySelector('[data-library-search]');
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '项目');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(900);
const searched = await tiles();
check('按项目名搜索有结果', searched > 0 && searched <= shown, `${searched} / ${shown}`);

// 3. 搜不到
await ev(`(() => {
  const input = document.querySelector('[data-library-search]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'zzz-不存在');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(900);
check('无匹配时给空状态', (await ev(`!!document.querySelector('[data-library-empty]')`)) === true);

// 4. 清除
await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /清除筛选|Clear/.test(b.textContent || ''));
  btn?.click();
})()`);
await delay(900);
check('清除筛选后恢复', (await tiles()) === shown, `${await tiles()} / ${shown}`);

// 5. 打开预览
await ev(`document.querySelector('[data-library-open]')?.click()`);
await delay(800);
const preview = await ev(`(() => {
  const dialog = document.querySelector('[data-library-preview]');
  if (!dialog) return null;
  return {
    hasMedia: !!dialog.querySelector('img, video, audio'),
    hasProject: !!dialog.querySelector('[data-library-open-project]'),
    hasDownload: !!dialog.querySelector('a[download]'),
  };
})()`);
check('预览打开并有媒体', preview?.hasMedia === true, JSON.stringify(preview));
check('预览里有项目入口', preview?.hasProject === true);
check('预览里有下载', preview?.hasDownload === true);

await ev(`document.querySelector('[data-library-preview]')?.click()`);
await delay(500);
check('点背景关闭预览', (await ev(`!!document.querySelector('[data-library-preview]')`)) === false);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(VERIFY_DIR + 'asset-library.png', Buffer.from(shot.data, 'base64'));

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
process.exit(fails.length || errors.length ? 1 : 0);

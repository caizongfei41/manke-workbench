// 一致性绑定 + 主页标语轮播 + 分镜直传
// @needs: comfyui —— 会真正提交生成任务；CI 无 GPU，跳过这一套

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
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
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// ---------- 1) 主页标语轮播 ----------
console.log('\n=== 主页标语 ===');
await send('Page.navigate', { url: `${APP}/zh` });
await delay(4000);
const slogan1 = await ev("document.querySelector('h1')?.textContent?.trim() ?? ''");
check('第一条标语', String(slogan1).includes('漫客工作台'), String(slogan1).slice(0, 30));
check('旧标语已移除', !(await ev("document.body.innerText.includes('化繁为简')")));

let rotated = false;
let seen = slogan1;
for (let i = 0; i < 12; i++) {
  await delay(1000);
  const now = await ev("document.querySelector('h1')?.textContent?.trim() ?? ''");
  if (now !== seen) { seen = now; rotated = true; break; }
}
check('标语会自动轮播', rotated, String(seen).slice(0, 30));
check('切换后的文案属于三条标语之一', ['漫客工作台', '一画一影一曲', '图生万象'].some((k) => String(seen).includes(k)), String(seen).slice(0, 24));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'home-slogan.png', Buffer.from(shot.data, 'base64'));

// ---------- 2) 一致性绑定 ----------
console.log('\n=== 一致性绑定 ===');
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '一致性绑定' }) })).json();

const { readFileSync } = await import('node:fs');
const png = readFileSync(OUT + 'test-upload.png');
const upload = async (name) => {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), name);
  const r = await fetch(`${APP}/api/app/projects/${proj.id}/assets`, {
    method: 'POST',
    body: fd,
    headers: { 'x-beatapi-workspace-request': '1', origin: APP },
  });
  const j = await r.json();
  return j.asset?.publicUrl ?? j.publicUrl ?? null;
};
const charUrl = await upload('char.png');
const sceneUrl = await upload('scene.png');
check('两张参考图已上传', !!charUrl && !!sceneUrl);

await fetch(`${COMFY}/interrupt`, { method: 'POST' });
const body = {
  generation: {
    version: 2, projectId: proj.id, modelId: '小枫-aicg3d-h3-长视频', mode: 'video',
    prompt: '测试', references: [],
    parameters: {
      aspect_ratio: '16:9', wmDuration: '12s', wmOutputQuality: '480p',
      director_global: { resolution: '480P' },
      director_segments: [
        { prompt: '第 1 镜', seconds: 3, imageUrls: [charUrl, sceneUrl], refs: [{ kind: 'character', name: '阿明', description: '黑色风衣' }, { kind: 'scene', name: '雨夜街头' }] },
        { prompt: '第 2 镜', seconds: 3, imageUrls: [charUrl, sceneUrl], refs: [{ kind: 'character', name: '阿明', description: '黑色风衣' }, { kind: 'scene', name: '雨夜街头' }] },
      ],
    },
  },
};
const j = await (await fetch(`${APP}/api/effects/generate`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
const pid = j?.output?.promptId;
await delay(9000);
const q = await (await fetch(`${COMFY}/queue`)).json();
const p = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])].find((x) => x[1] === pid)?.[2];
if (!p) check('任务入队', false, '队列里没有');
else {
  check('任务入队', true);
  const segs = Object.entries(p).filter(([, n]) => n?.class_type === 'AICG3D_H3SequenceSegment');
  const prompts = segs.map(([, n]) => String(n.inputs.prompt));
  check('提示词写入了 <Subject 1>', prompts.every((x) => x.includes('<Subject 1>')), prompts[0].slice(0, 60));
  check('提示词写入了 <Picture 1>', prompts.every((x) => x.includes('<Picture 1>')));
  check('场景绑定到 <Picture 2>', prompts.every((x) => x.includes('<Picture 2>') && x.includes('场景')));
  const media = segs.map(([, n]) => JSON.parse(n.inputs.inline_media_state || '{}'));
  const counts = media.map((s) => (s.images ?? []).length);
  check('每段都带 2 张参考图', counts.every((c) => c === 2), counts.join(','));
  const firstImages = media.map((s) => (s.images ?? [])[0]);
  check('人物图每段一致', new Set(firstImages).size === 1, [...new Set(firstImages)].join(','));
}
await fetch(`${COMFY}/interrupt`, { method: 'POST' });

// ---------- 3) 分镜直传 ----------
console.log('\n=== 分镜直传 ===');
await send('Page.navigate', { url: `${APP}/zh/studio/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(800); if ((await ev("!!document.querySelector('[data-beatapi-composer]')")) === true) break; }
await delay(2500);

await ev("document.querySelector('[data-beatapi-composer] button[aria-label=\"Media type\"]')?.click()");
await delay(800);
await ev("[...document.querySelectorAll('[role=\"option\"]')].find(o => (o.textContent||'').trim() === '视频')?.click()");
await delay(2200);
await ev("document.querySelector('[data-beatapi-composer] button[aria-label=\"Model\"]')?.click()");
await delay(900);
const mi = await ev("[...document.querySelectorAll('[role=\"option\"]')].findIndex(o => (o.textContent||'').includes('长视频 · 画质优先'))");
if (mi >= 0) { await ev(`[...document.querySelectorAll('[role="option"]')][${mi}]?.click()`); await delay(2500); }

await ev("(() => { const b=[...document.querySelectorAll('[data-beatapi-composer] button')].find(x => (x.textContent||'').includes('导入剧本')); b?.click(); })()");
await delay(900);
await ev("(() => { const b=[...document.querySelectorAll('[data-beatapi-composer] button')].find(x => (x.textContent||'').includes('套用模板')); b?.click(); })()");
await delay(800);
await ev("(() => { const b=[...document.querySelectorAll('[data-beatapi-composer] button')].find(x => (x.textContent||'').includes('切分成分镜')); b?.click(); })()");
await delay(1800);

// The shot list renders a tick after the split, so poll instead of sampling once.
let uploadBtns = 0;
for (let i = 0; i < 12; i++) {
  uploadBtns = await ev("[...document.querySelectorAll('[data-beatapi-composer] button')].filter(b => (b.textContent||'').trim() === '上传').length");
  if (uploadBtns >= 2) break;
  await delay(700);
}
check('每段都有上传按钮', uploadBtns >= 2, `${uploadBtns} 个`);

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'shot-upload.png', Buffer.from(shot2.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

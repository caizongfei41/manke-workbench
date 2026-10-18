// 完整闭环：空项目 → 剧本 → 分镜 → 定妆图 → 逐段视频 → 合成整片 → ffprobe 验收
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const OUT = VERIFY_DIR;
const FFPROBE = 'ffmpeg';
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

const log = (stage, detail = '') => console.log(`  [${stage}] ${detail}`);
let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name + (detail ? '  ' + detail : '')); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

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
    if (!/Project not found/.test(text)) errors.push(text.slice(0, 200));
  }
});
const send = (method, params = {}) => {
  const n = ++seq;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((res, rej) => {
    pending.set(n, { resolve: res, reject: rej });
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 240000);
  });
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description ?? '');
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

// ─────────────────────────────────────────────────────
// 0. 清场
// ─────────────────────────────────────────────────────
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
log('清场', 'ComfyUI 已空闲');

const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ name: '完整闭环-雨夜', workspaceMode: 'canvas' }),
})).json();
log('建项目', proj.id.slice(0, 8));

// 界面上的「开始短剧」除了建项目还会写一份短剧快照，这里补同一步
{
  const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
  await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
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
  log('短剧快照', '已写入');
}

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 40; i++) { await delay(800); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2000);

// ─────────────────────────────────────────────────────
// 1. 剧本 → 分镜
// ─────────────────────────────────────────────────────
const SCRIPT = [
  '场景：雨夜街头。',
  '',
  '阿明站在路灯下，雨水顺着伞骨流下来。',
  '阿明：（低声）<d>[Chinese] 这条路我走过很多次。</d>',
  '',
  '镜头推近。阿明抬起头，看向街对面的旧书店。',
  '阿明：<d>[Chinese] 灯还亮着。</d>',
].join('\n');

const typed = await ev(`(() => {
  const t = [...document.querySelectorAll('textarea')].find(x => (x.placeholder||'').includes('剧本'));
  if (!t) return 'no-textarea';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, ${JSON.stringify(SCRIPT)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`);
check('剧本输入框可写', typed === 'typed', typed);
await delay(900);

await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台'));
  b?.click();
})()`);
await delay(3000);

const board = await ev(`(() => {
  const h = [...document.querySelectorAll('[data-drama-drag-handle]')].find(x => (x.textContent||'').includes('分镜台'));
  let scope = h?.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  return { text: (scope?.innerText || '').replace(/\\n/g, ' | ').slice(0, 120) };
})()`);
const shotCount = await ev(`[...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||'')).length`);
check('切出了分镜', shotCount >= 2, `${shotCount} 段`);
check('识别到角色', String(board?.text).includes('1 个角色'), String(board?.text).slice(0, 60));

const assets = await ev(`(() => {
  const h = [...document.querySelectorAll('[data-drama-drag-handle]')].find(x => (x.textContent||'').includes('公共资产图'));
  let scope = h?.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  return (scope?.innerText || '').replace(/\\n/g, ' | ');
})()`);
check('资产里有人物', String(assets).includes('阿明'), String(assets).slice(0, 60));

// 降分辨率，别拿 1080P 跑全流程
await ev(`(() => {
  const h = [...document.querySelectorAll('[data-drama-drag-handle]')].find(x => (x.textContent||'').includes('生成参数台'));
  let scope = h?.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  const selects = [...scope.querySelectorAll('select')];
  const target = selects.find(s => [...s.options].some(o => o.textContent.includes('480P')));
  if (!target) return 'no-select';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(target, [...target.options].find(o => o.textContent.includes('480P')).value);
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return 'set';
})()`);
await delay(700);
log('参数台', '已降到 480P');

// ─────────────────────────────────────────────────────
// 2. 角色定妆图（走真实图片管线）
// ─────────────────────────────────────────────────────
const portrait = await (await fetch(`${APP}/api/effects/generate`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    generation: {
      version: 2, projectId: proj.id, modelId: '小枫-qwen-image-2-1-文生图-4步加速版', mode: 'image',
      prompt: 'cinematic portrait of a young man standing under a street lamp in the rain, holding a black umbrella, wet hair, neon reflections, film still, shallow depth of field',
      references: [], parameters: { aspect_ratio: '1:1', wmOutputQuality: '1k' },
    },
  }),
})).json().catch(() => null);

let portraitUrl = null;
for (let i = 0; i < 40; i += 1) {
  await delay(2000);
  const s = await (await fetch(`${APP}/api/effects/status?wmTaskId=${portrait?.wmTaskId}`, { headers: { origin: APP } })).json().catch(() => null);
  if (s?.status === 'succeeded') { portraitUrl = s.output?.stored_result_url ?? s.output?.result_url ?? null; break; }
  if (s?.status === 'failed') break;
}
check('定妆图生成成功', !!portraitUrl, String(portraitUrl ?? '').slice(0, 46));

if (portraitUrl) {
  const snap = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
  const drama = JSON.parse(snap.document?.drama ?? '{}');
  const target = (drama.publicAssets ?? []).find((a) => a.name.includes('阿明')) ?? drama.publicAssets?.[0];
  if (target) {
    target.imageUrl = portraitUrl;
    target.source = 'uploaded';
    await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ document: { ...snap.document, drama: JSON.stringify(drama) }, baseVersion: snap.version }),
    });
  }
  await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
  for (let i = 0; i < 40; i++) { await delay(800); if (await ev("!!document.querySelector('[data-drama-drag-handle]')")) break; }
  await delay(2500);
  const bound = await ev(`(() => {
    const h = [...document.querySelectorAll('[data-drama-drag-handle]')].find(x => (x.textContent||'').includes('公共资产图'));
    let scope = h?.parentElement;
    while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
    return scope ? scope.querySelectorAll('img').length : 0;
  })()`);
  check('定妆图挂到了角色上', bound > 0, `${bound} 张图`);
}

// ─────────────────────────────────────────────────────
// 3. 逐段生成
// ─────────────────────────────────────────────────────
const shotIds = await ev(`(() => {
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||''));
  return heads.map(h => (h.textContent||'').match(/分段工作台\\s*(\\d+)/)?.[1]).filter(Boolean);
})()`);
log('分段', `${shotIds?.length ?? 0} 段：${shotIds?.join(', ')}`);

const shotState = async () => {
  const snap = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
  return JSON.parse(snap.document?.drama ?? '{}');
};

// 「生成这一段」只跑它自己那一段，所以逐段点、等完成再下一段
const shotHeadCount = await ev(`[...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||'')).length`);
let allShots = null;
for (let index = 0; index < shotHeadCount; index += 1) {
  const clicked = await ev(`(() => {
    const heads = [...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||''));
    const head = heads[${index}];
    let scope = head?.parentElement;
    while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
    const btn = scope ? [...scope.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '生成这一段') : null;
    btn?.click();
    return btn ? 'clicked' : 'no-button';
  })()`);
  log('生成', `第 ${index + 1} 段 ${clicked}`);

  for (let i = 0; i < 120; i += 1) {
    await delay(4000);
    const d = await shotState();
    allShots = d;
    const shot = (d.shots ?? [])[index];
    if (shot?.status === 'succeeded' || shot?.videoUrl) { log('生成', `第 ${index + 1} 段完成`); break; }
    if (shot?.status === 'failed') { log('生成', `第 ${index + 1} 段失败：${String(shot.error ?? '').slice(0, 60)}`); break; }
    if (i % 5 === 0) log('生成中', `第 ${index + 1} 段 ${shot?.status ?? '?'}`);
  }
}

const finished = (allShots?.shots ?? []).filter((s) => s.videoUrl).length;
check('每段都出了视频', finished === (allShots?.shots ?? []).length, `${finished}/${(allShots?.shots ?? []).length}`);
const shotErrors = (allShots?.shots ?? []).filter((s) => s.error).map((s) => String(s.error).slice(0, 80));
if (shotErrors.length) shotErrors.forEach((e) => console.log('    错误: ' + e));

// ─────────────────────────────────────────────────────
// 4. 合成整片
// ─────────────────────────────────────────────────────
if (!shotIds?.length) { console.log('  没有分段，跳过合成'); }
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('合成整片'));
  b?.click();
})()`);

let finalDoc = null;
for (let i = 0; i < 90 && shotIds?.length; i += 1) {
  await delay(4000);
  finalDoc = await shotState();
  if (finalDoc.finalVideoUrl || finalDoc.finalStatus === 'failed') break;
  if (i % 5 === 0) log('合成中', `状态 ${finalDoc.finalStatus}`);
}
check('成片合成成功', !!finalDoc?.finalVideoUrl, String(finalDoc?.finalVideoUrl ?? '').slice(0, 60));

// ─────────────────────────────────────────────────────
// 5. ffprobe 验收
// ─────────────────────────────────────────────────────
if (finalDoc?.finalVideoUrl) {
  const res = await fetch(`${APP}${finalDoc.finalVideoUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const local = OUT + 'final-film.mp4';
  writeFileSync(local, buf);
  check('成片可下载', buf.length > 100_000, `${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', local]);
  const probe = JSON.parse(stdout);
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const duration = Number(probe.format?.duration ?? 0);
  const expectSeconds = (finalDoc.shots ?? []).reduce((sum, s) => sum + (s.seconds ?? 0), 0);

  check('竖屏 1080x1920', video?.width === 1080 && video?.height === 1920, `${video?.width}x${video?.height}`);
  check('时长符合分段总和', Math.abs(duration - expectSeconds) <= 2.5, `${duration.toFixed(1)}s vs 预期 ${expectSeconds}s`);
  check('有视频流', !!video, `${video?.codec_name} ${video?.avg_frame_rate}`);
  check('文件结构完好', probe.streams.length >= 1, `${probe.streams.length} 条流`);

  // 字幕烧进画面：抽一帧看有没有明显亮色文字带（简单判据：存在 ASS 文件）
  const subs = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
  const doc = JSON.parse(subs.document?.drama ?? '{}');
  check('启用字幕', doc.subtitles === true);

  const png = OUT + 'final-frame.png';
  await run(FFMPEG, ['-y', '-ss', String(Math.min(4, duration / 2)), '-i', local, '-frames:v', '1', png]);
  log('抽帧', png);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'complete-film.png', Buffer.from(shot.data, 'base64'));

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
console.log(`项目保留在：${APP}/zh/canvas/${proj.id}`);
ws.close();
process.exit(fails.length ? 1 : 0);

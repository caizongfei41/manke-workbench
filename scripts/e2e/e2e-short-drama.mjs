// 端到端：剧本 → 资产图 → 逐段生成 → 字幕 → 竖屏 → 剪辑台
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;
const SHOTS = OUT + 'e2e-shots\\';
const LOG = OUT + 'e2e.log';
const FFMPEG = 'ffmpeg';

mkdirSync(SHOTS, { recursive: true });
writeFileSync(LOG, '', 'utf8');
const log = (msg) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n', 'utf8');
};

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name + (detail ? '  ' + detail : '')); log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

const tabs = await (await fetch(`${CDP}/json`)).json();
for (const extra of tabs.filter((t) => t.type === 'page' && /3020/.test(t.url)).slice(1)) {
  await fetch(`${CDP}/json/close/${extra.id}`).catch(() => {});
}
const tab = tabs.find((t) => t.type === 'page' && /3020/.test(t.url));
if (!tab) { log('没有页面'); process.exit(1); }
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
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 120000);
  });
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const shoot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOTS + name + '.png', Buffer.from(png.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("localStorage.setItem('manke-theme','light')");

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

// ── 1. 建项目 ───────────────────────────────────────────────
const proj = await (await fetch(`${APP}/api/app/projects`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: '端到端短片', workspaceMode: 'canvas' }),
})).json();
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
log(`项目 ${proj.id.slice(0, 8)}`);

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);
check('画布打开', await ev("!!document.querySelector('textarea')") === true);

// ── 2. 剧本 ─────────────────────────────────────────────────
const SCRIPT = `【人物】
阿明：28 岁，黑色风衣，短发

【场景】
雨夜街头：深夜，霓虹，冷色调

【第1段｜3秒】
中景，雨夜街头，阿明撑伞站定，雨水沿伞沿滴落。
<d>[Chinese] 你终于来了。</d>

【第2段｜3秒】
近景，阿明抬头看向镜头，眼神疲惫。
<d>[Chinese] 我等了你一整夜。</d>

【第3段｜3秒】
特写，雨滴落在他的肩上，霓虹在他眼里化开。`;

await ev(`(() => {
  const t = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, ${JSON.stringify(SCRIPT)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await delay(900);
const typed = await ev("document.querySelector('textarea').value.length");
check('剧本完整贴进去了', typed === SCRIPT.length, `${typed} / ${SCRIPT.length}`);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台')); b?.click(); })()`);
await delay(2500);

const built = await ev(`(() => {
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')];
  return {
    shots: heads.filter(h => /分段工作台/.test(h.textContent||'')).length,
    assets: heads.filter(h => /公共资产图/.test(h.textContent||'')).length,
  };
})()`);
check('切出 3 段', built?.shots === 3, `${built?.shots} 段`);
check('识别出公共资产', built?.assets === 1);

// ── 3. 角色定妆图 ───────────────────────────────────────────
log('生成定妆图…');
const portrait = await (await fetch(`${APP}/api/effects/generate`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    generation: {
      version: 2, projectId: proj.id, modelId: '小枫-qwen-image-2-1-文生图-4步加速版',
      mode: 'image',
      prompt: 'cinematic portrait of a young man in a black coat, short dark hair, neutral expression, rainy night neon background',
      references: [], parameters: { aspect_ratio: '9:16', wmOutputQuality: '1k' },
    },
  }),
})).json();
for (let i = 0; i < 60; i += 1) {
  await delay(4000);
  const s = await (await fetch(`${APP}/api/effects/status?wmTaskId=${portrait.wmTaskId}`, { headers: { origin: APP } })).json().catch(() => null);
  if (s?.status === 'succeeded' || s?.status === 'failed') break;
}
const gens = await (await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })).json();
const portraitUrl = (gens.items ?? []).find((g) => g.id === portrait.wmTaskId)?.resultUrl;
check('定妆图生成', !!portraitUrl, String(portraitUrl ?? '').slice(0, 40));

const portraitFile = SHOTS + 'portrait.png';
if (portraitUrl) {
  writeFileSync(portraitFile, Buffer.from(await (await fetch(`${APP}${portraitUrl}`)).arrayBuffer()));
}

// 上传到「角色1」的 换图 输入
if (portraitUrl) {
  const opened = await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '换图');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  await delay(900);
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file][accept*="image"]' });
  if (input?.nodeId) {
    await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [portraitFile] });
    await delay(4000);
  }
  const attached = await ev(`(() => {
    const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /公共资产图/.test(h.textContent||''));
    let scope = head.parentElement;
    while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
    return (scope.innerText||'').includes('1/') || !!scope.querySelector('img');
  })()`);
  check('定妆图挂到角色上', attached === true, `${opened}`);
  await shoot('01-assets');
}

// ── 4. 参数台：增强 + 竖屏 ──────────────────────────────────
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  let scope = head.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  const boxes = [...scope.querySelectorAll('input[type=checkbox]')];
  boxes[boxes.length - 1].click();
})()`);
await delay(700);
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  let scope = head.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  [...scope.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '只他一人')?.click();
  [...scope.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '锁机位')?.click();
})()`);
await delay(900);
await shoot('02-params');
check('增强已开启', await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => (h.textContent||'').includes('生成参数台'));
  let scope = head.parentElement;
  while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
  return (scope.innerText||'').includes('提示词增强') && (scope.innerText||'').includes('只他一人');
})()`) === true);

// ── 5. 逐段续跑 ─────────────────────────────────────────────
log('开始逐段生成（3 段，约 4 分钟）…');
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('续跑未完成的'));
  b?.click();
})()`);

let allDone = false;
for (let i = 0; i < 140; i += 1) {
  await delay(6000);
  const state = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('续跑未完成的'));
    const running = /正在跑第/.test(document.body.innerText || '');
    const done = /全部 \\d+ 段都已完成/.test(document.body.innerText || '');
    return { resume: b ? (b.textContent||'').trim() : null, running, done };
  })()`);
  if (i % 5 === 0) log(`  ${JSON.stringify(state)}`);
  if (state?.done) { allDone = true; break; }
}
check('三段全部生成完成', allDone);

const snap = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
let drama = JSON.parse(snap.document?.drama ?? '{}');
const withVideo = (drama.shots ?? []).filter((s) => s.videoUrl);
check('每段都有成片', withVideo.length === 3, `${withVideo.length} 段`);
check('每段都留了版本', (drama.shots ?? []).every((s) => (s.versions ?? []).length >= 1));
await shoot('03-generated');

// ── 6. 拼接（带字幕，竖屏） ─────────────────────────────────
log('拼接成片（烧字幕 + 竖屏 1080×1920）…');
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('拼接已生成的'));
  b?.click();
})()`);

let finalUrl = null;
for (let i = 0; i < 40; i += 1) {
  await delay(4000);
  const s2 = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
  drama = JSON.parse(s2.document?.drama ?? '{}');
  if (drama.finalVideoUrl) { finalUrl = drama.finalVideoUrl; break; }
}
check('拼出成片', !!finalUrl, String(finalUrl ?? '').slice(0, 50));
await shoot('04-final');

// ── 7. 检查产物 ─────────────────────────────────────────────
if (finalUrl) {
  const local = OUT + 'e2e-final.mp4';
  writeFileSync(local, Buffer.from(await (await fetch(`${APP}${finalUrl}`)).arrayBuffer()));
  const probe = await run(FFMPEG, ['-i', local, '-hide_banner'], { encoding: 'utf8' }).catch((e) => ({ stderr: e.stderr ?? '' }));
  const info = String(probe.stderr ?? '');
  const dims = (info.match(/Video:.*?(\d{2,4})x(\d{2,4})/) ?? []).slice(1, 3).map(Number);
  const duration = (info.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? []).slice(1);
  const seconds = duration.length === 3 ? Number(duration[0]) * 3600 + Number(duration[1]) * 60 + Number(duration[2]) : 0;

  check('成片是竖屏 1080×1920', dims[0] === 1080 && dims[1] === 1920, `${dims[0]}x${dims[1]}`);
  check('成片有音轨', /Stream #0:1.*Audio/.test(info));
  check('时长接近 3×3 秒', seconds > 8 && seconds < 16, `${seconds.toFixed(1)}s`);

  // 每段抽一帧，看字幕
  for (let i = 0; i < 3; i += 1) {
    const t = i * 3.5 + 1.2;
    await run(FFMPEG, ['-y', '-ss', String(t), '-i', local, '-frames:v', '1', '-vf', 'scale=360:-1', `${SHOTS}final-${i + 1}.png`]).catch(() => {});
  }
  log('已抽 3 帧检查字幕');
}

// ── 8. 送进剪辑台 ───────────────────────────────────────────
if (finalUrl) {
  const assetId = finalUrl.match(/\/assets\/([0-9a-f-]{36})/i)?.[1];
  const res = await fetch(`${APP}/api/app/projects/${proj.id}/send-to-editor`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ assetId, name: '端到端剪辑' }),
  });
  const json = await res.json().catch(() => null);
  check('送进剪辑台', res.status === 200 && !!json?.projectId, `HTTP ${res.status}`);
  if (json?.projectId) {
    const list = await (await fetch(`${APP}/api/app/projects`, { headers: { origin: APP } })).json();
    const created = (list.projects ?? []).find((p) => p.id === json.projectId);
    check('新项目是剪辑工作区', created?.lastWorkspaceMode === 'editor', String(created?.lastWorkspaceMode));
    await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [json.projectId] }) });
  }
}

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

log('');
log(`=== 端到端: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => log('  - ' + f));
if (errors.length) { log('页面异常:'); [...new Set(errors)].forEach((e) => log('  ! ' + e)); }
else log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

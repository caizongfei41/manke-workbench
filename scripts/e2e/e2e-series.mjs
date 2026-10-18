// 两部曲：角色库把同一个角色带到第二部片子
// A 部生成定妆图 → 存入库；B 部从库取用 → 图是同一张字节；删掉 A 后 B 仍然可用
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const OUT = VERIFY_DIR;
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

const log = (s, d = '') => console.log(`  [${s}] ${d}`);
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
    setTimeout(() => { if (pending.delete(n)) rej(new Error(method + ' timeout')); }, 180000);
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
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

// ── 工具 ───────────────────────────────────────────────
const SCRIPT = [
  '场景：雨夜街头。',
  '',
  '阿明站在路灯下，雨水顺着伞骨流下来。他抬头看向街对面的旧书店。',
  '阿明：<d>[Chinese] 灯还亮着。</d>',
].join('\n');

const emptyDrama = () => JSON.stringify({
  version: 1, script: '', positions: {}, links: [],
  params: { resolution: '480P' }, loras: [], subtitles: true, exportPreset: 'vertical',
  enhance: { enabled: false, rules: [], extra: '' },
  bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
  publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle',
});

const createFilm = async (name) => {
  const proj = await (await fetch(`${APP}/api/app/projects`, {
    method: 'POST', headers: H, body: JSON.stringify({ name, workspaceMode: 'canvas' }),
  })).json();
  const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
  await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      document: { version: 3, canvasKind: 'drama', cards: [], frames: {}, drama: emptyDrama() },
      baseVersion: cur?.version ?? null,
    }),
  });
  return proj.id;
};

const dramaOf = async (projectId) => {
  const snap = await (await fetch(`${APP}/api/app/projects/${projectId}/snapshot`, { headers: { origin: APP } })).json();
  return JSON.parse(snap.document?.drama ?? '{}');
};

const openBoard = async (projectId) => {
  await send('Page.navigate', { url: `${APP}/zh/canvas/${projectId}` });
  for (let i = 0; i < 40; i += 1) { await delay(800); if (await ev("!!document.querySelector('textarea')")) break; }
  await delay(2200);
};

const typeScript = async () => {
  await ev(`(() => {
    const t = [...document.querySelectorAll('textarea')].find(x => (x.placeholder||'').includes('剧本'));
    if (!t) return 'no-textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, ${JSON.stringify(SCRIPT)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await delay(800);
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台'));
    b?.click();
  })()`);
  await delay(3200);
};

const generatePortrait = async (projectId) => {
  const task = await (await fetch(`${APP}/api/effects/generate`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      generation: {
        version: 2, projectId, modelId: '小枫-qwen-image-2-1-文生图-4步加速版', mode: 'image',
        prompt: 'cinematic portrait of a young man under a street lamp in the rain, black umbrella, wet hair, neon reflections, film still',
        references: [], parameters: { aspect_ratio: '1:1', wmOutputQuality: '1k' },
      },
    }),
  })).json().catch(() => null);

  for (let i = 0; i < 40; i += 1) {
    await delay(2000);
    const s = await (await fetch(`${APP}/api/effects/status?wmTaskId=${task?.wmTaskId}`, { headers: { origin: APP } })).json().catch(() => null);
    if (s?.status === 'succeeded') return s.output?.stored_result_url ?? s.output?.result_url ?? null;
    if (s?.status === 'failed') return null;
  }
  return null;
};

const attachPortrait = async (projectId, url) => {
  const snap = await (await fetch(`${APP}/api/app/projects/${projectId}/snapshot`, { headers: { origin: APP } })).json();
  const drama = JSON.parse(snap.document?.drama ?? '{}');
  const target = (drama.publicAssets ?? []).find((a) => a.name.includes('阿明'));
  if (!target) return false;
  target.imageUrl = url;
  target.source = 'uploaded';
  await fetch(`${APP}/api/app/projects/${projectId}/snapshot`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ document: { ...snap.document, drama: JSON.stringify(drama) }, baseVersion: snap.version }),
  });
  return true;
};

const hashOf = async (url) => {
  const res = await fetch(`${APP}${url}`);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
};

const generateShots = async (projectId) => {
  const heads = await ev(`[...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||'')).length`);
  for (let index = 0; index < heads; index += 1) {
    await ev(`(() => {
      const hs = [...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||''));
      const head = hs[${index}];
      let s = head?.parentElement;
      while (s && getComputedStyle(s).position !== 'absolute') s = s.parentElement;
      const btn = s ? [...s.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '生成这一段') : null;
      btn?.click();
    })()`);
    for (let i = 0; i < 100; i += 1) {
      await delay(4000);
      const d = await dramaOf(projectId);
      const shot = (d.shots ?? [])[index];
      if (shot?.videoUrl) break;
      if (shot?.status === 'failed') { log('生成失败', String(shot.error ?? '').slice(0, 70)); break; }
      if (i % 6 === 0) log('生成中', `第 ${index + 1}/${heads} 段`);
    }
    log('生成', `第 ${index + 1} 段完成`);
  }
};

const compose = async (projectId) => {
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('合成整片'));
    b?.click();
  })()`);
  for (let i = 0; i < 70; i += 1) {
    await delay(4000);
    const d = await dramaOf(projectId);
    if (d.finalVideoUrl || d.finalStatus === 'failed') return d;
    if (i % 6 === 0) log('合成中', String(d.finalStatus));
  }
  return await dramaOf(projectId);
};

// ─────────────────────────────────────────────────────
// 第一部
// ─────────────────────────────────────────────────────
log('A 部', '建项目');
const filmA = await createFilm('两部曲-第一部');
await openBoard(filmA);
await typeScript();

const aDrama = await dramaOf(filmA);
const aCast = (aDrama.publicAssets ?? []).filter((x) => x.kind === 'character').map((x) => x.name);
check('A 部认出角色', aCast.includes('阿明'), JSON.stringify(aCast));

const aPortrait = await generatePortrait(filmA);
check('A 部定妆图生成', !!aPortrait, String(aPortrait ?? '').slice(0, 40));
await attachPortrait(filmA, aPortrait);
await openBoard(filmA);

// 存入库（走界面）
await ev(`(() => {
  const h = [...document.querySelectorAll('[data-drama-drag-handle]')].find(x => (x.textContent||'').includes('公共资产图'));
  let s = h?.parentElement;
  while (s && getComputedStyle(s).position !== 'absolute') s = s.parentElement;
  const btns = s ? [...s.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label')||'') === '从角色库选图') : [];
  btns[0]?.click();
})()`);
await delay(1500);
const aPanelOpen = await ev(`!!document.querySelector('[role="dialog"][aria-label="从角色库选图"]')`);
check('A 部打开角色库', aPanelOpen === true);

await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  const b = p ? [...p.querySelectorAll('button')].find(x => (x.textContent||'').includes('存入库')) : null;
  b?.click();
})()`);
await delay(2500);

const lib = await (await fetch(`${APP}/api/app/cast-library`, { headers: { origin: APP } })).json();
const libItem = (lib.items ?? []).find((x) => x.name === '阿明');
check('角色已存进库', !!libItem, `${(lib.items ?? []).length} 条`);

const aHash = libItem ? await hashOf(libItem.url) : null;
check('库里的图可读', !!aHash, String(aHash ?? ''));

// A 部成片
await generateShots(filmA);
const aFinal = await compose(filmA);
check('A 部成片完成', !!aFinal.finalVideoUrl, String(aFinal.finalVideoUrl ?? '').slice(0, 40));

// ─────────────────────────────────────────────────────
// 第二部
// ─────────────────────────────────────────────────────
log('B 部', '建项目');
const filmB = await createFilm('两部曲-第二部');
await openBoard(filmB);
await typeScript();

const bDramaBefore = await dramaOf(filmB);
const bCast = (bDramaBefore.publicAssets ?? []).filter((x) => x.kind === 'character').map((x) => x.name);
check('B 部认出同一个角色', bCast.includes('阿明'), JSON.stringify(bCast));

await ev(`(() => {
  const h = [...document.querySelectorAll('[data-drama-drag-handle]')].find(x => (x.textContent||'').includes('公共资产图'));
  let s = h?.parentElement;
  while (s && getComputedStyle(s).position !== 'absolute') s = s.parentElement;
  const btns = s ? [...s.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label')||'') === '从角色库选图') : [];
  btns[0]?.click();
})()`);
await delay(1800);

const grid = await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  const imgs = p ? [...p.querySelectorAll('img')] : [];
  return imgs.map(i => i.getAttribute('src'));
})()`);
check('B 部看得到 A 部的角色', (grid ?? []).length >= 1, `${(grid ?? []).length} 张`);

await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  const b = p?.querySelector('button[title]');
  b?.click();
})()`);
await delay(2500);

const bDrama = await dramaOf(filmB);
const bTarget = (bDrama.publicAssets ?? []).find((x) => x.name.includes('阿明'));
check('B 部角色挂上了图', !!bTarget?.imageUrl, String(bTarget?.imageUrl ?? '').slice(0, 46));

const bHash = bTarget?.imageUrl ? await hashOf(bTarget.imageUrl) : null;
check('两部是同一个人（字节一致）', !!bHash && bHash === aHash, `${aHash} vs ${bHash}`);
check('B 部用的是自己的副本', String(bTarget?.imageUrl).includes(filmB) && !String(bTarget?.imageUrl).includes(filmA), '');

// B 部成片
await generateShots(filmB);
const bFinal = await compose(filmB);
check('B 部成片完成', !!bFinal.finalVideoUrl, String(bFinal.finalVideoUrl ?? '').slice(0, 40));

if (bFinal.finalVideoUrl) {
  const buf = Buffer.from(await (await fetch(`${APP}${bFinal.finalVideoUrl}`)).arrayBuffer());
  const local = OUT + 'series-film-b.mp4';
  writeFileSync(local, buf);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', local]);
  const probe = JSON.parse(stdout);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  check('B 部竖屏 1080x1920', v?.width === 1080 && v?.height === 1920, `${v?.width}x${v?.height}`);
  await run('ffmpeg', ['-y', '-ss', '3', '-i', local, '-frames:v', '1', OUT + 'series-frame-b.png']);
}

// ─────────────────────────────────────────────────────
// 删掉第一部，第二部还得能看
// ─────────────────────────────────────────────────────
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [filmA] }) });
const afterDelete = bTarget?.imageUrl ? await fetch(`${APP}${bTarget.imageUrl}`) : null;
check('删掉第一部后第二部定妆图仍在', afterDelete?.status === 200, `HTTP ${afterDelete?.status}`);
const afterHash = bTarget?.imageUrl ? await hashOf(bTarget.imageUrl) : null;
check('删除后字节不变', afterHash === aHash, `${afterHash}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'series-b.png', Buffer.from(shot.data, 'base64'));

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
console.log(`第二部保留在：${APP}/zh/canvas/${filmB}`);
ws.close();
process.exit(fails.length ? 1 : 0);

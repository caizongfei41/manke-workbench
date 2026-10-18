// 跨项目角色库：存入库 → 在另一个项目里取用 → 图是复制过去的，不依赖源项目
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const OUT = VERIFY_DIR;
const FFMPEG = 'ffmpeg';
const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };

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

// 一张真图当定妆图
const png = OUT + 'cast-test.png';
await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=0x3355aa:s=512x512', '-frames:v', '1', png]);
const pngBytes = (await import('node:fs')).readFileSync(png);

const createDrama = async (name) => {
  const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name, workspaceMode: 'canvas' }) })).json();
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
          publicAssets: [
            { id: 'a1', kind: 'character', name: '阿明', description: '', imageUrl: null },
          ],
          shots: [], finalVideoUrl: null, finalStatus: 'idle',
        }),
      },
      baseVersion: cur?.version ?? null,
    }),
  });
  return proj.id;
};

const upload = async (projectId) => {
  const form = new FormData();
  form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'aming.png');
  const res = await fetch(`${APP}/api/app/projects/${projectId}/assets`, { method: 'POST', headers: { 'x-beatapi-workspace-request': '1', origin: APP }, body: form });
  const json = await res.json().catch(() => null);
  const assetId = json?.assetId ?? json?.id ?? json?.asset?.id;
  // 上传接口不保证回 publicUrl，按约定路径拼出来
  const url = json?.publicUrl ?? (assetId ? `/api/app/projects/${projectId}/assets/${assetId}` : null);
  return { assetId, url };
};

// ── A. 项目一：存入库（走 UI 的「库」按钮） ─────────────
// 测试必须自己清场：角色库是一个真实项目，上一轮留下的条目会让断言失败
{
  const list = await (await fetch(`${APP}/api/app/projects`, { headers: { origin: APP } })).json();
  const lib = (list.projects ?? []).filter((p) => p.name === '漫客角色库');
  if (lib.length) {
    await fetch(`${APP}/api/app/projects`, {
      method: 'DELETE', headers: H,
      body: JSON.stringify({ projectIds: lib.map((p) => p.id) }),
    });
    console.log('  （清掉遗留的角色库）');
  }
}
const projectA = await createDrama('角色库-来源项目');
const a = await upload(projectA);
check('项目一上传了定妆图', !!a.assetId, String(a.assetId ?? '').slice(0, 8));

// 把图挂到资产上（模拟用户换图）
const curA = await (await fetch(`${APP}/api/app/projects/${projectA}/snapshot`, { headers: { origin: APP } })).json();
const dramaA = JSON.parse(curA.document?.drama ?? '{}');
dramaA.publicAssets[0].imageUrl = a.url;
await fetch(`${APP}/api/app/projects/${projectA}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({ document: { ...curA.document, drama: JSON.stringify(dramaA) }, baseVersion: curA.version }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${projectA}` });
for (let i = 0; i < 30; i++) { await delay(800); if (await ev("!!document.querySelector('[data-drama-drag-handle]')")) break; }
await delay(2500);

const libButton = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'') === '从角色库选图');
  return btn ? 'found' : 'missing';
})()`);
check('资产行有「库」按钮', libButton === 'found', libButton);

await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'') === '从角色库选图');
  btn?.click();
})()`);
await delay(1500);

const panel = await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  if (!p) return null;
  return { text: (p.textContent||'').slice(0, 60), hasSave: (p.textContent||'').includes('存入库') };
})()`);
check('打开了角色库面板', !!panel, JSON.stringify(panel));
check('面板提示库为空', String(panel?.text).includes('库还是空的'), String(panel?.text).slice(0, 30));

await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  const btn = [...p.querySelectorAll('button')].find(b => (b.textContent||'').includes('存入库'));
  btn?.click();
})()`);
await delay(2500);

const saved = await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  return p ? (p.textContent||'').slice(-40) : 'closed';
})()`);
check('存入库有反馈', String(saved).includes('已存入库') || String(saved).includes('1 张'), String(saved));

const libList = await (await fetch(`${APP}/api/app/cast-library`, { headers: { origin: APP } })).json();
check('库里有 1 张', (libList.items ?? []).length === 1, `${(libList.items ?? []).length} 张`);
check('库条目带角色名', libList.items?.[0]?.name === '阿明', String(libList.items?.[0]?.name));

// ── B. 项目二：从库里取用 ──────────────────────────────
const projectB = await createDrama('角色库-使用项目');
await send('Page.navigate', { url: `${APP}/zh/canvas/${projectB}` });
for (let i = 0; i < 30; i++) { await delay(800); if (await ev("!!document.querySelector('[data-drama-drag-handle]')")) break; }
await delay(2500);

await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'') === '从角色库选图');
  btn?.click();
})()`);
await delay(1500);

const grid = await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  const imgs = p ? p.querySelectorAll('img') : [];
  return { count: imgs.length, first: imgs[0]?.getAttribute('src') ?? null };
})()`);
check('项目二能看到库里的图', grid?.count === 1, `${grid?.count} 张`);

await ev(`(() => {
  const p = document.querySelector('[role="dialog"][aria-label="从角色库选图"]');
  const btn = p?.querySelector('button[title]');
  btn?.click();
})()`);
await delay(2500);

const snapB = await (await fetch(`${APP}/api/app/projects/${projectB}/snapshot`, { headers: { origin: APP } })).json();
const dramaB = JSON.parse(snapB.document?.drama ?? '{}');
const urlB = dramaB.publicAssets?.[0]?.imageUrl;
check('项目二的资产挂上了图', !!urlB, String(urlB ?? '').slice(0, 40));
check('图是项目二自己的（复制而非引用）', String(urlB).includes(projectB) && !String(urlB).includes(projectA), `${String(urlB).slice(0, 30)}…`);

// ── C. 删掉源项目，使用方的图仍可访问 ──────────────────
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [projectA] }) });
const stillThere = urlB ? await fetch(`${APP}${urlB}`, { method: 'HEAD' }) : null;
check('源项目删掉后使用方文件仍在', stillThere?.status === 200, `HTTP ${stillThere?.status}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'cast-library.png', Buffer.from(shot.data, 'base64'));

// 清理：项目 B + 库里的条目
const libProject = (await (await fetch(`${APP}/api/app/projects`, { headers: { origin: APP } })).json()).projects?.find((p) => p.name === '漫客角色库');
const toDelete = [projectB];
if (libProject) toDelete.push(libProject.id);
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: toDelete }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

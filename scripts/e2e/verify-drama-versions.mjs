// 多版本保留 / 采用 + 送进剪辑台
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
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '多版本验证', workspaceMode: 'canvas' }) })).json();

// 一段带 3 个版本，采用中间那版
const versions = [
  { id: 'v3', url: '/api/app/projects/x/assets/v3', createdAt: 3000 },
  { id: 'v2', url: '/api/app/projects/x/assets/v2', createdAt: 2000 },
  { id: 'v1', url: '/api/app/projects/x/assets/v1', createdAt: 1000 },
];
const shots = [
  { id: 's1', index: 0, title: '第 1 段', prompt: '中景。<d>[Chinese] 你来了。</d>', seconds: 3, publicAssetIds: [], ownImageUrls: [], videoUrl: versions[1].url, versions, status: 'succeeded' },
];
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: {}, loras: [], subtitles: true, bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [], shots, finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);

// 1) 版本 UI
const ui = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /分段工作台 1/.test(h.textContent||''));
  if (!head) return null;
  const scope = head.parentElement.parentElement;
  return {
    counter: (scope.innerText||'').match(/第 \\d+\\/\\d+ 版/)?.[0] ?? null,
    hasPrev: [...scope.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '上一版'),
    hasNext: [...scope.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '下一版'),
    adoptLabel: [...scope.querySelectorAll('button')].map(b => (b.textContent||'').trim()).find(t => t === '采用这版' || t === '已采用') ?? null,
  };
})()`);
check('显示版本计数', ui?.counter === '第 1/3 版', String(ui?.counter));
check('有前后切换', ui?.hasPrev === true && ui?.hasNext === true);
check('有采用按钮', !!ui?.adoptLabel, String(ui?.adoptLabel));

// 2) 切到第 2 版（采用的是中间那版 -> 显示已采用）
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /分段工作台 1/.test(h.textContent||''));
  const scope = head.parentElement.parentElement;
  const next = [...scope.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '下一版');
  next.click();
})()`);
await delay(700);
const after = await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /分段工作台 1/.test(h.textContent||''));
  const scope = head.parentElement.parentElement;
  return {
    counter: (scope.innerText||'').match(/第 \\d+\\/\\d+ 版/)?.[0] ?? null,
    adopt: [...scope.querySelectorAll('button')].map(b => (b.textContent||'').trim()).find(t => t === '采用这版' || t === '已采用') ?? null,
  };
})()`);
check('切到第 2 版', after?.counter === '第 2/3 版', String(after?.counter));
check('第 2 版显示已采用', after?.adopt === '已采用', String(after?.adopt));

// 3) 切到第 3 版并采用
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /分段工作台 1/.test(h.textContent||''));
  const scope = head.parentElement.parentElement;
  [...scope.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '下一版').click();
})()`);
await delay(500);
await ev(`(() => {
  const head = [...document.querySelectorAll('[data-drama-drag-handle]')].find(h => /分段工作台 1/.test(h.textContent||''));
  const scope = head.parentElement.parentElement;
  [...scope.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '采用这版')?.click();
})()`);
await delay(2200);
const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(saved.document?.drama ?? '{}');
const s1 = (drama.shots ?? []).find((s) => s.id === 's1');
check('采用写进快照', s1?.videoUrl === versions[2].url, String(s1?.videoUrl));
check('三个版本都还在', (s1?.versions ?? []).length === 3, `${(s1?.versions ?? []).length} 个`);

// 4) 送进剪辑台
await ev(`(() => { document.querySelectorAll('input[type=checkbox]').forEach((b, i) => { if (i === 0) b.checked; }); })()`);
const toEditor = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '送进剪辑台');
  return b ? 'present' : 'missing';
})()`);
check('没有成片时不显示送剪辑（预期）', toEditor === 'missing', String(toEditor));

// 直接打接口，验证服务端链路
const upload = await (async () => {
  const res = await fetch(`${APP}/api/app/projects/${proj.id}/assets`, { method: 'POST', headers: { 'x-beatapi-workspace-request': '1', origin: APP }, body: (() => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(2048)], { type: 'video/mp4' }), 'fake.mp4');
    return form;
  })() });
  const j = await res.json().catch(() => null);
  return j?.assetId ?? j?.id ?? j?.asset?.id;
})();
const sendRes = await fetch(`${APP}/api/app/projects/${proj.id}/send-to-editor`, {
  method: 'POST', headers: H, body: JSON.stringify({ assetId: upload, name: '剪辑测试' }),
});
const sendJson = await sendRes.json().catch(() => null);
check('送进剪辑接口成功', sendRes.status === 200 && !!sendJson?.projectId, `HTTP ${sendRes.status} ${JSON.stringify(sendJson).slice(0, 90)}`);

if (sendJson?.projectId) {
  const list = await (await fetch(`${APP}/api/app/projects`, { headers: { origin: APP } })).json();
  const created = (list.projects ?? []).find((p) => p.id === sendJson.projectId);
  check('新项目是剪辑工作区', created?.lastWorkspaceMode === 'editor', String(created?.lastWorkspaceMode ?? null));
  await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [sendJson.projectId] }) });
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-versions.png', Buffer.from(shot.data, 'base64'));

await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

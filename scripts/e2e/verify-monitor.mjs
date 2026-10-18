// 运行时监控 + 失败分类
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9232';
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
const OUT = VERIFY_DIR;
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
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
{
  const q = await fetch(`${COMFY}/queue`).then((r) => r.json()).catch(() => null);
  for (const item of q?.queue_pending ?? []) {
    await fetch(`${COMFY}/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: [item[0]] }),
    }).catch(() => {});
  }
}
await delay(1500);

// ── A. 监控接口 ────────────────────────────────────────
const monitor = await (await fetch(`${APP}/api/app/comfyui/monitor`, { headers: { origin: APP } })).json();
check('监控接口连得上 ComfyUI', monitor?.reachable === true);
check('报出了显存总量', monitor?.vramTotalGb > 0, `${monitor?.vramUsedGb}/${monitor?.vramTotalGb}G`);
check('报出了队列', monitor?.running === 0 && monitor?.pending === 0, `跑 ${monitor?.running} / 等 ${monitor?.pending}`);
check('报出了显卡型号', /RTX|NVIDIA|cuda/i.test(String(monitor?.device)), String(monitor?.device).slice(0, 40));

// ── B. 顶栏显示 ───────────────────────────────────────
const shellProj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '监控外壳', workspaceMode: 'studio' }) })).json();
await send('Page.navigate', { url: `${APP}/zh/studio/${shellProj.id}` });
await delay(4500);
const pill = await ev(`(() => {
  const el = document.querySelector('[data-comfy-monitor]');
  if (!el) return null;
  return { state: el.dataset.comfyMonitor, text: (el.textContent||'').trim(), title: (el.getAttribute('title')||'') };
})()`);
check('顶栏有监控指示器', !!pill, JSON.stringify(pill));
check('指示器显示在线', pill?.state === 'live', String(pill?.state));
check('显示显存数字', /显存 \d+(\.\d+)?\/\d+(\.\d+)?G/.test(String(pill?.text)), String(pill?.text));
check('悬停有显卡与内存明细', /RTX|NVIDIA/.test(String(pill?.title)) && /内存/.test(String(pill?.title)), String(pill?.title).replace(/\n/g, ' | ').slice(0, 60));

// ── C. 队列真有任务时会变 ─────────────────────────────
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '监控验证', workspaceMode: 'studio' }) })).json();
await fetch(`${APP}/api/effects/generate`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    generation: {
      version: 2, projectId: proj.id, modelId: '小枫-aicg3d-h3-长视频', mode: 'video',
      prompt: 'queue observation', references: [],
      parameters: {
        aspect_ratio: '16:9', wmDuration: '12s', wmOutputQuality: '480p',
        director_global: { resolution: '480P' },
        director_segments: [
          { prompt: '中景，雨夜街头。', seconds: 3, imageUrls: [], refs: [] },
          { prompt: '近景，抬头。', seconds: 3, imageUrls: [], refs: [] },
        ],
      },
    },
  }),
}).catch(() => {});
// 提交到真正入队有延迟（模型要加载），轮询而不是死等 6 秒
let busyMonitor = null;
for (let i = 0; i < 20; i += 1) {
  await delay(1500);
  busyMonitor = await (await fetch(`${APP}/api/app/comfyui/monitor`, { headers: { origin: APP } })).json();
  if (busyMonitor.running + busyMonitor.pending > 0) break;
}
check('有任务时队列不为 0', busyMonitor.running + busyMonitor.pending > 0, `跑 ${busyMonitor.running} / 等 ${busyMonitor.pending}`);

await send('Page.navigate', { url: `${APP}/zh/studio/${shellProj.id}?t=${Date.now()}` });
await delay(4500);
const busyPill = await ev(`(() => {
  const el = document.querySelector('[data-comfy-monitor]');
  return el ? (el.textContent||'').trim() : null;
})()`);
check('顶栏跟着显示队列', /跑|队列/.test(String(busyPill)), String(busyPill));
await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});

// ── D. 失败分类显示 ───────────────────────────────────
const drama = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '失败分类验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${drama.id}/snapshot`, { headers: { origin: APP } })).json();
const cases = [
  ['s1', 'RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB'],
  ['s2', 'Cannot execute because node AICG3D_H3Loader does not exist.'],
  ['s3', 'request timed out after 300s'],
];
await fetch(`${APP}/api/app/projects/${drama.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: {
      version: 3, canvasKind: 'drama', cards: [], frames: {},
      drama: JSON.stringify({
        version: 1, script: '', positions: {}, links: [],
        params: {}, loras: [], subtitles: false, exportPreset: 'vertical',
        enhance: { enabled: false, rules: [], extra: '' },
        bgmAssetId: null, bgmName: null, bgmVolume: 0.25,
        publicAssets: [],
        shots: cases.map(([id, error], index) => ({
          id, index, title: `第 ${index + 1} 段`, prompt: '中景。', seconds: 3,
          publicAssetIds: [], ownImageUrls: [], videoUrl: null, versions: [],
          status: 'failed', error,
        })),
        finalVideoUrl: null, finalStatus: 'idle',
      }),
    },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${drama.id}` });
for (let i = 0; i < 30; i++) { await delay(800); if (await ev("!!document.querySelector('[data-drama-drag-handle]')")) break; }
await delay(2500);

const shown = await ev(`(() => {
  const heads = [...document.querySelectorAll('[data-drama-drag-handle]')].filter(h => /分段工作台/.test(h.textContent||''));
  return heads.map(h => {
    let scope = h.parentElement;
    while (scope && getComputedStyle(scope).position !== 'absolute') scope = scope.parentElement;
    return (scope?.innerText || '').replace(/\\n/g, ' | ');
  });
})()`);
const joined = (shown ?? []).join('\n');
check('显存不足被命名', joined.includes('显存不足'), '');
check('缺节点被命名', joined.includes('缺少节点'));
check('超时被命名', joined.includes('超时'));
check('安装类问题有「重试也没用」的提示', joined.includes('重试也没用'), '');
check('显存不足给出降压建议', joined.includes('降低分辨率'));
check('原始错误仍然可见', joined.includes('CUDA out of memory'));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'monitor-failures.png', Buffer.from(shot.data, 'base64'));

await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {});
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id, drama.id, shellProj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

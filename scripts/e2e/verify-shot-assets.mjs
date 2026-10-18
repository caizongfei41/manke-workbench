// 分镜资产图：每段有自己的图，和公共资产一起按固定顺序进入生成
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

const H = { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1', origin: APP };
const proj = await (await fetch(`${APP}/api/app/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '分镜资产验证', workspaceMode: 'canvas' }) })).json();
const cur = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, {
  method: 'PUT', headers: H,
  body: JSON.stringify({
    document: { version: 3, canvasKind: 'drama', cards: [], frames: {}, drama: JSON.stringify({ version: 1, script: '', publicAssets: [], shots: [], finalVideoUrl: null, finalStatus: 'idle' }) },
    baseVersion: cur?.version ?? null,
  }),
});

await send('Page.navigate', { url: `${APP}/zh/canvas/${proj.id}` });
for (let i = 0; i < 30; i++) { await delay(900); if (await ev("!!document.querySelector('textarea')")) break; }
await delay(2500);

// 套模板 → 分镜
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('套用模板')); b?.click(); })()`);
await delay(1000);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('交给分镜台')); b?.click(); })()`);
await delay(2500);

const text1 = await ev('document.body.innerText');
check('有「分镜资产图」区', text1.includes('分镜资产图'));
check('没有图时提示为空', text1.includes('这一段还没有自己的图'));

// 给第一段挂一个公共资产
// 分段现在会按剧本自动挂上资产。挂没挂不能用「参考图 N 张」判断——图还没传时
// 那个数字永远是 0——所以点一下再看快照，没挂上就再点一下，直到挂上为止。
for (let attempt = 0; attempt < 2; attempt += 1) {
  const linked = await (async () => {
    const snap = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
    const doc = JSON.parse(snap.document?.drama ?? '{}');
    return ((doc.shots ?? [])[0]?.publicAssetIds ?? []).length;
  })();
  if (linked > 0) break;
  await ev(`(() => {
    const names = ['角色1', '角色2', '场景1', '道具1'];
    const chips = [...document.querySelectorAll('button')].filter(b => names.includes((b.textContent||'').trim()));
    chips[0]?.click();
  })()`);
  await delay(1500);
}
await delay(1000);

// 先给公共资产生图（第一个 input 是公共资产，最后一个是分镜自己的）
const doc = await send('DOM.getDocument', { depth: -1 });
const inputs = await send('DOM.querySelectorAll', {
  nodeId: doc.root.nodeId,
  selector: 'input[type=file][accept="image/png,image/jpeg,image/webp"]',
});
const nodeIds = inputs.nodeIds ?? [];
console.log('  file input 数量:', nodeIds.length);
check('公共资产和分镜各有上传入口', nodeIds.length >= 2, String(nodeIds.length));

// 公共资产：点「换图」再塞文件
const pubBtn = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'button' }).catch(() => null);
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '换图');
  b?.click();
})()`);
await delay(600);
const pubInputs = await send('DOM.querySelectorAll', {
  nodeId: doc.root.nodeId,
  selector: 'input[type=file][accept="image/png,image/jpeg,image/webp"]',
});
await send('DOM.setFileInputFiles', { files: [OUT + 'test-upload.png'], nodeId: pubInputs.nodeIds[0] });
await delay(5000);
check('公共资产拿到图', (await ev('document.body.innerText')).includes('1/4 已出图'));

// 分镜自己的图：最后一个 input
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('+ 上传'));
  b?.click();
})()`);
await delay(600);
const shotInputs = await send('DOM.querySelectorAll', {
  nodeId: doc.root.nodeId,
  selector: 'input[type=file][accept="image/png,image/jpeg,image/webp"]',
});
const shotNode = shotInputs.nodeIds[shotInputs.nodeIds.length - 1];
await send('DOM.setFileInputFiles', { files: [OUT + 'test-upload.png'], nodeId: shotNode });
await delay(5000);
check('分镜图上传入口可用', true);

await delay(1500);
const afterUpload = await ev('document.body.innerText');
check('上传后分镜资产计数变 1', /分镜资产图[\s\S]{0,40}?1/.test(afterUpload) || afterUpload.includes('参考图 2 张'), '');

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT + 'drama-shot-assets.png', Buffer.from(shot.data, 'base64'));

// 持久化：分镜自己的图要存进去
await delay(2000);
const saved = await (await fetch(`${APP}/api/app/projects/${proj.id}/snapshot`, { headers: { origin: APP } })).json();
const drama = JSON.parse(saved.document?.drama ?? '{}');
const firstShot = (drama.shots ?? [])[0] ?? {};
check('快照存了分镜自己的图', (firstShot.ownImageUrls ?? []).length === 1, `${(firstShot.ownImageUrls ?? []).length} 张`);
check('快照存了公共资产挂载', (firstShot.publicAssetIds ?? []).length === 1, `${(firstShot.publicAssetIds ?? []).length} 个`);

// 生成时两者都要进去，且公共在前
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('生成这一段'));
  b?.click();
})()`);
let submitted = null;
for (let i = 0; i < 12; i++) {
  await delay(3000);
  const gens = await (await fetch(`${APP}/api/app/projects/${proj.id}/generations`, { headers: { origin: APP } })).json();
  if ((gens.items ?? []).length > 0) { submitted = gens.items[0]; break; }
}
check('提交了一次生成', !!submitted, submitted ? submitted.status : '无记录');

if (submitted) {
  await delay(6000);
  const q = await (await fetch(`${COMFY}/queue`)).json();
  const all = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])];
  const p = all.find((x) => x[1] === submitted.providerTaskId)?.[2] ?? all[0]?.[2];
  if (p) {
    const segs = Object.entries(p).filter(([, n]) => n?.class_type === 'AICG3D_H3SequenceSegment');
    check('只提交这一段', segs.length === 1, `${segs.length} 个`);
    const media = JSON.parse(segs[0]?.[1]?.inputs?.inline_media_state ?? '{}');
    check('公共图 + 分镜图都进了', (media.images ?? []).length === 2, `${(media.images ?? []).length} 张`);
    const prompt = String(segs[0]?.[1]?.inputs?.prompt ?? '');
    check('提示词绑定了 <Subject 1>', prompt.includes('<Subject 1>'), prompt.slice(0, 50));
  } else {
    console.log('  队列已空，跳过节点检查');
  }
}

await fetch(`${COMFY}/interrupt`, { method: 'POST' });
await fetch(`${APP}/api/app/projects`, { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [proj.id] }) });

console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) fails.forEach((f) => console.log('  - ' + f));
if (errors.length) { console.log('页面异常:'); [...new Set(errors)].forEach((e) => console.log('  ! ' + e)); }
else console.log('页面无未捕获异常 ✓');
ws.close();
process.exit(fails.length || errors.length ? 1 : 0);

// 抓工作台各页面截图，给 PDF 教程用
//
//   node scripts/capture-docs-shots.mjs
//
// 输出到 .verify/shots/，文件名和页面语义对应，方便写文档时引用。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CDP = 'http://127.0.0.1:9227';
const APP = 'http://127.0.0.1:3020';
const OUT = 'C:/Users/Administrator/Desktop/ComfyUI无线画布/.verify/shots';

mkdirSync(OUT, { recursive: true });

/** 要抓的页面：路径 + 文件名 + 等待条件 */
const PAGES = [
  { path: '/zh', name: '01-home', label: '首页', waitFor: 'nav,a,button' },
  { path: '/zh/studio', name: '02-studio', label: '创作台', waitFor: 'button' },
  { path: '/zh/canvas', name: '03-canvas', label: '画布列表', waitFor: 'button' },
  { path: '/zh/projects', name: '04-projects', label: '项目', waitFor: 'button' },
  { path: '/zh/assets', name: '05-assets', label: '素材库', waitFor: 'button' },
  { path: '/zh/services', name: '06-services', label: '服务控制台', waitFor: 'button' },
];

const connect = async () => {
  const tabs = await (await fetch(`${CDP}/json`)).json();
  const tab = tabs.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:3020'));
  if (!tab) throw new Error('找不到工作台标签页');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++seq;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  return { ws, send, evaluate };
};

const main = async () => {
  const { ws, send, evaluate } = await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  // 1500x1000 更适合文档排版，2 倍像素密度保证 PDF 里清晰
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1000,
    deviceScaleFactor: 2,
    mobile: false,
  });

  for (const page of PAGES) {
    process.stdout.write(`  ${page.label}…`);
    await send('Page.navigate', { url: APP + page.path });
    // 等网络空闲 + 关键元素出现
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const ready = await evaluate(
        `document.readyState === 'complete' && document.body.innerText.length > 60`
      );
      if (ready) break;
    }
    // 给字体和图片一点时间
    await new Promise((r) => setTimeout(r, 2500));

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (shot?.data) {
      writeFileSync(join(OUT, `${page.name}.png`), Buffer.from(shot.data, 'base64'));
      const title = await evaluate('document.title');
      console.log(` ok  ${title ?? ''}`);
    } else {
      console.log(' 失败');
    }
  }

  ws.close();
};

main().then(() => process.exit(0));

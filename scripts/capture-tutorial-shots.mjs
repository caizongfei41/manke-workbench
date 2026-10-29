// 为图文教程截图（v2）
//
// 关键修正：抓 CDP 标签页时按 URL 精确匹配，而不是取第一个 page。
// 夸克会开多个内部窗口（分享、下载等），选错就永远等不到页面加载。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'http://127.0.0.1:3020';
const OUT = 'C:\\Users\\Administrator\\Desktop\\ComfyUI无线画布\\.verify\\shots\\tutorial';
const CDP_PORT = 9231;

mkdirSync(OUT, { recursive: true });

const PAGES = [
  { path: '/zh', name: '01-home', label: '首页' },
  { path: '/zh/studio', name: '02-studio', label: '创作台' },
  { path: '/zh/canvas', name: '03-canvas', label: '画布' },
  { path: '/zh/projects', name: '04-projects', label: '项目' },
  { path: '/zh/assets', name: '05-assets', label: '素材库' },
  { path: '/zh/services', name: '06-services', label: '服务控制台' },
  { path: '/zh/settings', name: '07-settings', label: '设置' },
];

const connect = async () => {
  const tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:3020'));
  if (!page) throw new Error('找不到工作台标签页');
  console.log(`  连接: ${page.url}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
    setTimeout(() => j(new Error('WebSocket 超时')), 10000);
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          res({});
        }
      }, 20000);
    });
  return { ws, send };
};

const main = async () => {
  const { ws, send } = await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });

  let ok = 0;
  for (const p of PAGES) {
    await send('Page.navigate', { url: APP + p.path });
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const r = await send('Runtime.evaluate', {
        expression:
          'JSON.stringify({s:document.readyState,l:document.body?document.body.innerText.length:0})',
        returnByValue: true,
      });
      const v = r.result?.result?.value;
      if (v) {
        const parsed = JSON.parse(v);
        if (parsed.s === 'complete' && parsed.l > 100) {
          ready = true;
          break;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1200));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const data = shot.result?.data;
    if (!data) {
      console.log(`  XX ${p.label}`);
      continue;
    }
    writeFileSync(join(OUT, `${p.name}.png`), Buffer.from(data, 'base64'));
    console.log(`  OK ${p.label.padEnd(10)} ${p.name}.png  ${ready ? '' : '(未完全加载)'}`);
    ok += 1;
  }

  ws.close();
  console.log('');
  console.log(`  ${ok}/${PAGES.length} 张`);
};

await main();

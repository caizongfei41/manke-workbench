// 通过 CDP 驱动夸克客户端上传（需要用户先带调试参数启动夸克）
//
// 用法：
//   1. 完全退出夸克
//   2. 用调试参数启动：
//      "%LOCALAPPDATA%\Programs\Quark\quark.exe" --remote-debugging-port=9230 --remote-allow-origins=*
//   3. node scripts/quark-upload.mjs --dir "E:\manke-big"
//
// 为什么需要 CDP：夸克的上传走的是它自己的 IPC，没有公开 API。
// 驱动界面里的「上传」按钮比逆向它的私有协议可靠得多。
const CDP = process.argv.find((a) => a.startsWith('--cdp='))?.split('=')[1] ?? '9230';
const DIR =
  process.argv.find((a) => a.startsWith('--dir='))?.split('=')[1] ?? 'E:\\manke-big';

const BASE = `http://127.0.0.1:${CDP}`;

const connect = async () => {
  const tabs = await (await fetch(`${BASE}/json`)).json();
  const page = tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到夸克窗口');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

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
    });
  return { ws, send, page };
};

const evaluate = async (send, expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result?.result?.value;
};

const main = async () => {
  const { ws, send, page } = await connect();
  console.log(`  已连接: ${page.title}`);
  console.log(`  URL: ${page.url}`);

  await send('Runtime.enable');

  const title = await evaluate(send, 'document.title');
  const href = await evaluate(send, 'location.href');
  const bodyText = await evaluate(
    send,
    'document.body ? document.body.innerText.slice(0,600) : "(no body)"'
  );

  console.log(`  标题: ${title}`);
  console.log(`  地址: ${href}`);
  console.log('  页面内容:');
  for (const line of String(bodyText ?? '').split('\n').slice(0, 20)) {
    if (line.trim()) console.log(`    ${line.trim()}`);
  }

  // 找一个 file input：Electron 客户端上传通常挂在隐藏的 input[type=file] 上
  const inputs = await evaluate(
    send,
    `JSON.stringify(Array.from(document.querySelectorAll('input[type=file]')).map((el,i)=>({i,accept:el.accept,multiple:el.multiple,hidden:el.offsetParent===null})))`
  );
  console.log(`  file input: ${inputs}`);

  ws.close();
};

await main();

// Verify the four fixes from this round.
//
//   1. A new canvas card is scrolled into view (it used to land off-screen).
//      Card creation is confirmed from the project snapshot, not from the DOM:
//      React Flow only mounts nodes inside the viewport, so DOM counts lie.
//   2. The empty assets library offers working ways forward.
//   3. Picking a starting idea fills the studio prompt.
//   4. The services page keeps showing a transitional state while a service
//      starts or stops.
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

import { setTimeout as delay } from 'node:timers/promises';

import { APP, openTab, waitForStable } from './ui-cdp.mjs';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(28)} ${detail}`);
};

const H = {
  'x-beatapi-workspace-request': '1',
  origin: APP,
  'content-type': 'application/json',
};

const cardCount = async (projectId) => {
  const r = await fetch(`${APP}/api/app/projects/${projectId}/snapshot`, { headers: H });
  if (!r.ok) return -1;
  const j = await r.json();
  return j.document?.cards?.length ?? 0;
};

const created = await (
  await fetch(`${APP}/api/app/projects`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ name: '修复验证' }),
  })
).json();
const PID = created.id;
console.log(`测试项目 ${PID.slice(0, 8)}`);

const tab = await openTab(`${APP}/zh/projects`);

// ── 1. 新卡片滚入视口
console.log('\n[1] 画布新卡片滚入视口');
await tab.send('Page.navigate', { url: `${APP}/zh/canvas/${PID}` });
await delay(2000);
await waitForStable(tab, { min: 5 });

// The newly inserted card is the selected one, so its rect tells us whether the
// camera followed it.
const selectedRect = `(() => {
  const el = document.querySelector('.react-flow__node.selected') ||
             document.querySelector('.react-flow__node[data-selected="true"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: Math.round(r.left), top: Math.round(r.top),
    right: Math.round(r.right), bottom: Math.round(r.bottom),
    vw: window.innerWidth, vh: window.innerHeight,
  };
})()`;

const trace = [];
let allGood = true;
for (let round = 1; round <= 4; round++) {
  const before = await cardCount(PID);
  await tab.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find((e) => (e.getAttribute('aria-label') || e.innerText || '').trim() === '生成节点');
    if (b) b.click();
  })()`);
  // The camera animation plus React Flow's commit take ~2-3s to settle;
  // measuring earlier reports a false 'off screen'.
  await delay(3000);
  const after = await cardCount(PID);
  const rect = await tab.evaluate(selectedRect);

  const added = after === before + 1;
  const inView =
    rect !== null &&
    rect.left >= -24 &&
    rect.top >= -24 &&
    rect.right <= rect.vw + 24 &&
    rect.bottom <= rect.vh + 24;
  trace.push(`${round}轮:${before}->${after}${inView ? '/在视口' : '/视口外'}`);
  if (!added || !inView) allGood = false;
}
record('4 次加卡片均创建且在视口内', allGood, trace.join('  '));

// ── 2. 素材页空状态入口
console.log('\n[2] 素材页空状态入口');
await tab.send('Page.navigate', { url: `${APP}/zh/assets/${PID}` });
await delay(2500);
await waitForStable(tab, { min: 3 });
const emptyActions = await tab.evaluate(`(() => {
  return [...document.querySelectorAll('a[href]')]
    .filter((a) => /\\/studio\\/|\\/editor\\//.test(a.getAttribute('href') || ''))
    .map((a) => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim() }))
    .filter((a) => a.text.length > 0 && !/studio|editor/.test(a.text));
})()`);
record(
  '空状态两个入口文案已翻译',
  emptyActions.length >= 2,
  JSON.stringify(emptyActions.map((a) => a.text))
);

// ── 3. 预设缩略图填提示词
console.log('\n[3] 预设缩略图填提示词');
await tab.send('Page.navigate', { url: `${APP}/zh/studio/${PID}` });
await delay(3000);
await waitForStable(tab, { min: 5 });
const before = await tab.evaluate(`(document.querySelector('textarea') || {}).value ?? ''`);
const clicked = await tab.evaluate(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find((e) => (e.getAttribute('aria-label') || '').startsWith('Select Cinematic'));
  if (!b) return false;
  b.click();
  return true;
})()`);
await delay(1200);
const after = await tab.evaluate(`(document.querySelector('textarea') || {}).value ?? ''`);
record(
  '点预设后提示词被填入',
  clicked && after.length > 20 && after !== before,
  `"${before.slice(0, 10)}" -> "${after.slice(0, 36)}…"`
);

// ── 4. 服务页过渡状态
console.log('\n[4] 服务页启停期间的状态');
await tab.send('Page.navigate', { url: `${APP}/zh/services` });
await delay(3000);
await waitForStable(tab, { min: 3 });
const stopHit = await tab.evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((e) => (e.innerText || '').trim() === '停止');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
if (stopHit) {
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: stopHit.x, y: stopHit.y, button: 'left', clickCount: 1 });
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stopHit.x, y: stopHit.y, button: 'left', clickCount: 1 });
  let sawTransition = false;
  for (let i = 0; i < 10; i++) {
    await delay(700);
    if (/停止中|启动中/.test(await tab.evaluate('document.body.innerText'))) {
      sawTransition = true;
      break;
    }
  }
  record('停止过程中显示「停止中」', sawTransition, sawTransition ? '出现过过渡状态' : '未观察到');
} else {
  record('停止过程中显示「停止中」', false, '找不到停止按钮');
}

await tab.close();
await fetch(`${APP}/api/app/projects`, {
  method: 'DELETE',
  headers: H,
  body: JSON.stringify({ projectIds: [PID] }),
}).catch(() => {});

const passed = results.filter((r) => r.ok).length;
console.log('\n==============================');
console.log(`修复验证: ${passed}/${results.length} 通过`);
process.exit(0);
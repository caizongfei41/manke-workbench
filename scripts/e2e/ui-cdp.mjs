// Shared CDP helper for the UI validation harness.
//
// Attaches to one tab, exposes a tiny promise-based CDP client, and collects
// console errors and failed network requests for the whole page lifetime so each
// click can be judged against what the app reported while it ran.
import { setTimeout as delay } from 'node:timers/promises';

export const CDP_PORT = process.env.VERIFY_CDP_PORT ?? (process.env.VERIFY_CDP ? new URL(process.env.VERIFY_CDP).port : '9232');
export const APP = process.env.APP_URL ?? 'http://127.0.0.1:3020';

export async function openTab(url) {
  const tab = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    })
  ).json();

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true });
  });

  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  const failedRequests = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
      return;
    }
    // Events below are collected rather than dispatched.
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(
        msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400)
      );
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        (msg.params.exceptionDetails?.exception?.description ??
          msg.params.exceptionDetails?.text ??
          'exception').slice(0, 400)
      );
    } else if (msg.method === 'Network.loadingFailed') {
      failedRequests.push(`${msg.params.type} ${msg.params.errorText}`);
    } else if (msg.method === 'Network.responseReceived') {
      const { status, url: reqUrl } = msg.params.response;
      if (status >= 400) failedRequests.push(`HTTP ${status} ${reqUrl.slice(0, 160)}`);
    }
  });

  const send = (method, params = {}) => {
    const n = ++seq;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((res, rej) => {
      pending.set(n, { resolve: res, reject: rej });
      setTimeout(() => {
        if (pending.delete(n)) rej(new Error(`${method} timed out`));
      }, 30000);
    });
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  /** Evaluate an expression in the page and return its value. */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text ?? 'evaluate failed');
    }
    return r.result.value;
  };

  const navigate = async (url, settleMs = 3500) => {
    await send('Page.navigate', { url });
    await delay(settleMs);
  };

  const screenshot = async (path) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(shot.data, 'base64'));
  };

  const close = async () => {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${tab.id}`).catch(() => {});
    ws.close();
  };

  const drain = () => {
    const snapshot = { consoleErrors: [...consoleErrors], failedRequests: [...failedRequests] };
    consoleErrors.length = 0;
    failedRequests.length = 0;
    return snapshot;
  };

  return { send, evaluate, navigate, screenshot, close, drain, delay };
}

/**
 * Enumerate everything clickable in the page.
 *
 * Elements are described rather than referenced, because handles do not survive
 * navigation or React re-renders; each entry carries a CSS-ish path that can be
 * re-resolved at click time.
 */
export const ENUMERATE_JS = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const label = (el) => {
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (text) return text.slice(0, 60);
    return el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
  };
  const sel = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="combobox"], [role="switch"], [role="checkbox"], select, input, textarea, summary';
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && ['hidden'].includes(el.type)) continue;
    const text = label(el);
    const key = tag + '|' + text + '|' + out.length;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      i: out.length,
      tag,
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      text,
      disabled: !!el.disabled,
      href: el.getAttribute('href') || '',
    });
  }
  return out;
})()`;

/** Resolve the element at `index` in document order and click it. */
export const clickAtJs = (index) => `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const sel = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="combobox"], [role="switch"], [role="checkbox"], select, input, textarea, summary';
  const list = [...document.querySelectorAll(sel)].filter((el) => {
    if (!visible(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && el.type === 'hidden') return false;
    return true;
  });
  const el = list[${index}];
  if (!el) return { clicked: false, reason: 'not found' };
  const before = (document.body.innerText || '').length;
  el.scrollIntoView({ block: 'center' });
  el.click();
  return {
    clicked: true,
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || '').trim().slice(0, 60),
    before,
  };
})()`;

/**
 * Wait until the interactive element count has settled.
 *
 * Views that mount canvas or timeline code render late: the canvas page reports
 * zero elements for the first ~3 s. Enumerating before that produces phantom
 * "element not found" results, so every navigation waits for stability first.
 */
export async function waitForStable(tab, { min = 1, maxMs = 20000, quietPolls = 2 } = {}) {
  const started = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - started < maxMs) {
    await delay(700);
    let count = 0;
    try {
      count = (await tab.evaluate(ENUMERATE_JS)).length;
    } catch {
      count = 0;
    }
    if (count >= min && count === last) {
      stable += 1;
      if (stable >= quietPolls) return count;
    } else {
      stable = 0;
    }
    last = count;
  }
  return last;
}

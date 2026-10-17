// Smoke-test the local MCP server: initialize handshake + tools/list over stdio.
import { spawn } from 'node:child_process';

const proc = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/mcp-server.ts'],
  { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] }
);

let buffer = '';
const pending = [];
proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const waiter = pending.find((w) => w.match(msg));
      if (waiter) { pending.splice(pending.indexOf(waiter), 1); waiter.resolve(msg); }
      else console.log('<<', line.slice(0, 200));
    } catch {
      console.log('<< (non-json)', line.slice(0, 160));
    }
  }
});
proc.stderr.on('data', (c) => process.stderr.write(`[stderr] ${c}`));

function request(msg, match, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${match}`)), timeoutMs);
    pending.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

const isMatch = (m, pat) => pat(m);

const init = await request(
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'beatdesign-deploy-check', version: '1.0.0' },
    },
  },
  (m) => m.id === 1
);
console.log('initialize  ->', JSON.stringify(init.result?.serverInfo ?? init.error));

const tools = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, (m) => m.id === 2);
const list = tools.result?.tools ?? [];
console.log(`tools/list  -> ${list.length} tools`);
for (const t of list) console.log(`   ${t.name}`);

proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
proc.kill();
process.exit(0);
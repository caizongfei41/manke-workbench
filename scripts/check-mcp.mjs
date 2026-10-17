// Verify the MCP server completes a handshake and lists its tools.
//
// The workbench ships an MCP server over stdio; "deployed correctly" includes
// that entry point working, and it is easy to break silently because nothing
// else exercises it.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const BD = process.cwd();
const TSX = join(BD, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SERVER = join(BD, 'scripts', 'mcp-server.ts');

const child = spawn(process.execPath, [TSX, SERVER], {
  cwd: BD,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, BEATDESIGN_GENERATION_PROVIDER: 'comfyui' },
});

let buf = '';
const responses = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { try { responses.push(JSON.parse(line)); } catch { /* partial */ } }
  }
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

send({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'deploy-check', version: '1.0.0' },
  },
});
await wait(2500);

send({ jsonrpc: '2.0', method: 'notifications/initialized' });
await wait(500);

send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
await wait(4000);

const init = responses.find((r) => r.id === 1);
const tools = responses.find((r) => r.id === 2);

console.log('=== initialize ===');
console.log(init?.result
  ? `OK  server=${init.result.serverInfo?.name} v${init.result.serverInfo?.version}`
  : `FAILED  ${JSON.stringify(init ?? responses).slice(0, 200)}`);

console.log('\n=== tools/list ===');
const list = tools?.result?.tools ?? [];
console.log(`工具数: ${list.length}`);
for (const t of list.slice(0, 40)) console.log(`  ${t.name}`);

if (stderr.trim()) console.log('\n=== stderr ===\n' + stderr.trim().slice(0, 600));

child.kill();
process.exit(init?.result && list.length > 0 ? 0 : 1);
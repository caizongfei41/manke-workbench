// Run every enabled template once and record the outcome.
//
// This is the deployment's acceptance test: a template that validates statically
// can still fail at execution time (missing weights the validator cannot resolve,
// a node that misbehaves at runtime, a model that will not load). Running all of
// them in sequence is the only way to know the workbench is actually usable.
//
// Sequential on purpose — parallel runs would contend for the 20 GB of VRAM.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const BD = process.cwd();
const WF = join(BD, 'data', 'comfyui', 'workflows');
const NODE = process.execPath;
const RUNNER = join(BD, 'scripts', 'run-template.mjs');
const REPORT = join(BD, 'data', 'logs', 'template-sweep.json');
const COMFY = 'http://127.0.0.1:8188';
const PER_TEMPLATE_TIMEOUT = 25 * 60 * 1000;

/**
 * Abandon whatever is still queued in ComfyUI.
 *
 * Killing the runner process does NOT cancel the prompt it already submitted —
 * ComfyUI keeps executing it server-side. Without this, a timed-out template
 * silently delays every later one and the next run races a stale job.
 */
async function drainQueue() {
  try {
    await fetch(`${COMFY}/interrupt`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 2000));
    await fetch(`${COMFY}/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clear: true }),
    });
    // Wait for it to actually settle.
    for (let i = 0; i < 30; i++) {
      const q = await (await fetch(`${COMFY}/queue`)).json();
      if (!q.queue_running?.length && !q.queue_pending?.length) return true;
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch { /* ComfyUI unreachable; nothing to drain */ }
  return false;
}

const templates = readdirSync(WF).filter((f) => f.endsWith('.json')).sort();
console.log(`sweeping ${templates.length} template(s)\n`);

const results = [];
const started = Date.now();

for (const [i, t] of templates.entries()) {
  const label = `[${String(i + 1).padStart(2)}/${templates.length}] ${t}`;
  process.stdout.write(`${label} ... `);
  const t0 = Date.now();
  let ok = false;
  let detail = '';
  try {
    const out = execFileSync(NODE, [RUNNER, t], {
      cwd: BD, encoding: 'utf8', timeout: PER_TEMPLATE_TIMEOUT, maxBuffer: 32 * 1024 * 1024,
    });
    // "SUCCESS" alone is not enough: a pruned graph finishes fast and writes
    // nothing. Require an actual artifact.
    ok = /SUCCESS/.test(out) && !/NO OUTPUT/.test(out);
    const m = out.match(/SUCCESS in (\d+)s/);
    detail = m ? `${m[1]}s` : (ok ? 'ok' : 'no SUCCESS marker');
    const produced = [...out.matchAll(/node \S+: (\S+)/g)].map((x) => x[1]);
    if (produced.length) detail += ` -> ${produced.slice(0, 3).join(', ')}`;
    else if (!ok) detail = 'SUCCESS but no output file (graph pruned)';
  } catch (e) {
    const out = String(e.stdout ?? '') + String(e.stderr ?? '');
    ok = /SUCCESS/.test(out) && !/NO OUTPUT/.test(out);
    const tail = out.trim().split('\n').slice(-3).join(' | ').slice(0, 220);
    if (/NO OUTPUT/.test(out)) detail = 'SUCCESS but no output file (graph pruned)';
    else detail = ok ? 'ok' : `FAIL: ${tail}`;
    if (!ok) {
      const drained = await drainQueue();
      detail += drained ? ' [queue drained]' : ' [queue drain failed]';
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`${ok ? 'SUCCESS' : 'FAILED'} ${secs}s`);
  results.push({ template: t, ok, seconds: Number(secs), detail });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed in ${((Date.now() - started) / 60000).toFixed(1)} min`);
for (const r of results.filter((x) => !x.ok)) console.log(`  FAILED ${r.template}: ${r.detail}`);

const { writeFileSync } = await import('node:fs');
writeFileSync(REPORT, JSON.stringify({
  at: new Date().toISOString(),
  pass, total: results.length, results,
}, null, 2), 'utf8');
console.log(`report -> ${REPORT}`);
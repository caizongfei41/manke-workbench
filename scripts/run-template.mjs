// End-to-end generation check: run one enabled template through ComfyUI and
// report whether it produced output. Video generation is slow and GPU-heavy, so
// the default template is trimmed to a short clip.
import { readFileSync } from 'node:fs';

const BASE = process.env.BEATDESIGN_COMFYUI_URL ?? 'http://127.0.0.1:8188';
const TEMPLATES = 'data/comfyui/workflows';
const file = process.argv[2] ?? '小枫-H3-导演-连贯成片.json';
const shortClip = process.argv.includes('--short');

const doc = JSON.parse(readFileSync(`${TEMPLATES}/${file}`, 'utf8'));
const prompt = {};
for (const [id, node] of Object.entries(doc)) if (!id.startsWith('_')) prompt[id] = node;

// Trim the clip so the check finishes in a reasonable time.
if (shortClip) {
  for (const node of Object.values(prompt)) {
    if (node.class_type !== 'MiniMaxH3Director') continue;
    node.inputs.total_frames = 49;                 // ~2s at 24fps
    const timeline = JSON.parse(node.inputs.timeline_data);
    timeline.totalFrames = 49;
    if (timeline.segments?.length) {
      timeline.segments[0].frameCount = 49;
      timeline.segments[0].length = 49;
      timeline.segments[0].durationSec = 2;
    }
    if (timeline.video) timeline.video.sourceFrameCount = 49;
    node.inputs.timeline_data = JSON.stringify(timeline);
  }
}

const res = await fetch(`${BASE}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt }),
});
const body = await res.json();
if (!res.ok) {
  const errs = [];
  for (const [id, e] of Object.entries(body.node_errors ?? {})) {
    const classType = prompt[id]?.class_type ?? '';
    for (const x of e.errors ?? []) errs.push(`${id} ${classType} ${x.type}: ${x.message}`);
  }
  console.log(`REJECTED\n${errs.join('\n') || JSON.stringify(body).slice(0, 400)}`);
  process.exit(1);
}

const promptId = body.prompt_id;
console.log(`submitted ${promptId} (${shortClip ? 'short clip' : 'full length'}), waiting...`);

const started = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  const hist = await (await fetch(`${BASE}/history/${promptId}`)).json();
  const entry = hist[promptId];
  if (!entry) continue;
  const status = entry.status?.status_str;
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  if (status === 'success') {
    console.log(`SUCCESS in ${elapsed}s`);
    // Include audio: the TTS template reports success while writing an .mp3,
    // and an earlier version of this check only looked at video/image outputs,
    // so that template appeared to produce nothing.
    let produced = 0;
    for (const [id, out] of Object.entries(entry.outputs ?? {})) {
      for (const v of [
        ...(out.videos ?? []), ...(out.gifs ?? []), ...(out.images ?? []),
        ...(out.audio ?? []), ...(out.result ?? []),
      ]) {
        const file = v?.filename ?? (typeof v === 'string' ? v : null);
        if (!file) continue;
        console.log(`  node ${id}: ${file}${v?.subfolder ? ` (${v.subfolder})` : ''}`);
        produced += 1;
      }
    }
    // A success with no artifact means the graph was pruned: ComfyUI can finish
    // in seconds without ever reaching the SaveImage branch.
    if (!produced) {
      console.log('  NO OUTPUT — the run reported success but produced no file');
      process.exit(1);
    }
    break;
  }
  if (status === 'error') {
    const exec = (entry.status.messages ?? []).find((m) => m[0] === 'execution_error');
    console.log(`ERROR after ${elapsed}s`);
    if (exec) {
      console.log(`  ${exec[1].node_type} @node ${exec[1].node_id}`);
      console.log(`  ${String(exec[1].exception_message).trim().slice(0, 500)}`);
    }
    process.exit(1);
  }
  if (Date.now() - started > 30 * 60_000) {
    console.log(`TIMED OUT after ${elapsed}s (status ${status})`);
    process.exit(1);
  }
}
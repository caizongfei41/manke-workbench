// Isolate whether SaveImage works as an output node at all.
//
// A template reports SUCCESS in 3s while its SaveImage branch never executes.
// Submitting the smallest possible graph — LoadImage feeding SaveImage — tells us
// whether the problem is SaveImage's registration or something specific to that
// template's structure.
const BASE = 'http://127.0.0.1:8188';

async function run(label, prompt) {
  const res = await fetch(`${BASE}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.log(`${label}: REJECTED ${JSON.stringify(body).slice(0, 300)}`);
    return;
  }
  const id = body.prompt_id;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await (await fetch(`${BASE}/history/${id}`)).json();
    const e = h[id];
    if (!e) continue;
    if (e.status?.status_str === 'success' || e.status?.status_str === 'error') {
      const outs = Object.keys(e.outputs ?? {});
      const cached = (e.status.messages ?? []).find((m) => m[0] === 'execution_cached')?.[1]?.nodes ?? [];
      console.log(`${label}: ${e.status.status_str}  outputs=[${outs}]  cached=[${cached}]`);
      for (const [nid, out] of Object.entries(e.outputs ?? {})) {
        for (const k of ['images', 'gifs', 'videos', 'audio']) {
          for (const f of out[k] ?? []) console.log(`    node ${nid}.${k} -> ${f.filename}`);
        }
      }
      return;
    }
  }
  console.log(`${label}: timed out`);
}

const IMG = '352474e31ab5d0bf4e5da57a32b957f4.jpg';

// A: the minimal case
await run('A 只 LoadImage->SaveImage', {
  1: { class_type: 'LoadImage', inputs: { image: IMG } },
  2: { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'probe_A' } },
});

// B: same, plus an easy imageSize output node — mirrors the broken template
await run('B 加 easy imageSize 输出节点', {
  1: { class_type: 'LoadImage', inputs: { image: IMG } },
  2: { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'probe_B' } },
  3: { class_type: 'easy imageSize', inputs: { image: ['1', 0] } },
});

// C: easy imageSize feeding nothing, SaveImage as the only real output
await run('C 只有 SaveImage（无 imageSize）', {
  1: { class_type: 'LoadImage', inputs: { image: IMG } },
  2: { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'probe_C' } },
});
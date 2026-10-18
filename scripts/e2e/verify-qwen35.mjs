const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';
const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';

// Verify the Qwen-Image 2.1 GGUF path end to end after allowing the qwen35
// architecture in the ComfyUI-GGUF guard list.
//
// Validation is not enough here: the decisive check is that the loader actually
// converts the quantized GGUF tensors and ComfyUI core recognises the model.
const BASE = `${COMFY}`;

const RUNS = [
  { file: 'Qwen-Image-2.1-PE-T2I.Q5_K_M.gguf', label: 'PE-T2I (text to image)' },
  { file: 'qwen-image-2.1-Q8_0.gguf', label: 'plain Q8_0' },
];

for (const { file, label } of RUNS) {
  const prompt = {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: file } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'a red apple on a wooden table' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
        seed: 7, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'bd-qwen35-probe' } },
  };

  const res = await fetch(`${BASE}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const body = await res.json();
  console.log(`\n${file}  (${label})`);
  if (!res.ok) {
    const errs = [];
    for (const [id, e] of Object.entries(body.node_errors ?? {})) {
      for (const x of e.errors ?? []) errs.push(`${id} ${x.type}: ${x.message}`);
    }
    console.log(`  REJECTED -> ${errs.join(' | ') || body.error?.message}`);
    continue;
  }

  const promptId = body.prompt_id;
  console.log('  submitted, executing...');
  let verdict = 'TIMED OUT';
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const hist = await (await fetch(`${BASE}/history/${promptId}`)).json();
    const entry = hist[promptId];
    if (!entry) {
      if (Date.now() - started > 15 * 60_000) break;
      continue;
    }
    const status = entry.status?.status_str;
    if (status === 'success') {
      const files = [];
      for (const out of Object.values(entry.outputs ?? {})) {
        for (const img of out.images ?? []) files.push(img.filename);
      }
      verdict = `SUCCESS -> ${files.join(', ') || 'no image file'}`;
      break;
    }
    if (status === 'error') {
      const exec = (entry.status.messages ?? []).find((m) => m[0] === 'execution_error');
      verdict = exec
        ? `ERROR ${exec[1].node_type} @${exec[1].node_id}: ${String(exec[1].exception_message).trim().slice(0, 180)}`
        : 'ERROR (unknown)';
      break;
    }
    if (Date.now() - started > 15 * 60_000) break;
  }
  console.log(`  -> ${verdict}`);
  await fetch(`${BASE}/interrupt`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 3000));
}
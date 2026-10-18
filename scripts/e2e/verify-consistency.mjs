// 一致性：同一角色图进每一段、顺序稳定、<Picture N> 编号不跳
const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

const COMFY = process.env.VERIFY_COMFY ?? 'http://127.0.0.1:8188';
import { setTimeout as delay } from 'node:timers/promises';
const APP = `${APP}`;
const H={'content-type':'application/json','x-beatapi-workspace-request':'1',origin:APP};
let pass=0; const fails=[];
const check=(n,ok,d='')=>{ if(ok){pass++;console.log(`  ok   ${n}${d?'  '+d:''}`);} else {fails.push(n);console.log(`  FAIL ${n}${d?'  '+d:''}`);} };

// 上传两张图做人物/场景
const { readFileSync } = await import('node:fs');
const png = readFileSync('./.verify/test-upload.png');
const proj = await (await fetch(APP+'/api/app/projects',{method:'POST',headers:H,body:JSON.stringify({name:'一致性验证'})})).json();

async function upload(name) {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), name);
  const r = await fetch(`${APP}/api/app/projects/${proj.id}/assets`, { method:'POST', body: fd, headers: { 'x-beatapi-workspace-request':'1', origin: APP } });
  if (!r.ok) return null;
  const j = await r.json();
  return j.asset?.publicUrl ?? j.publicUrl ?? j.url ?? null;
}
const u1 = await upload('char.png');
const u2 = await upload('scene.png');
console.log('  上传:', u1 ? 'ok' : 'fail', u2 ? 'ok' : 'fail');

// 直接走生成接口，每段都挂同一张人物图，看注入是否稳定
const segs = Array.from({length:5}, (_,i) => ({
  prompt: `第 ${i+1} 镜`, seconds: 3,
  imageUrls: u1 ? [u1] : [],
}));
const body = { generation: { version:2, projectId: proj.id, modelId:'小枫-aicg3d-h3-长视频', mode:'video',
  prompt:'测试', references:[], parameters:{ aspect_ratio:'16:9', wmDuration:'12s', wmOutputQuality:'480p',
  director_global:{ resolution:'480P' }, director_segments: segs } } };
await fetch(`${COMFY}/interrupt`,{method:'POST'});
const j = await (await fetch(APP+'/api/effects/generate',{method:'POST',headers:H,body:JSON.stringify(body)})).json();
const pid = j?.output?.promptId;
console.log('  promptId:', String(pid).slice(0,8));
await delay(9000);
const q = await (await fetch(`${COMFY}/queue`)).json();
const p = [...(q.queue_running??[]), ...(q.queue_pending??[])].find(x => x[1] === pid)?.[2];
if (!p) { check('任务入队', false, '队列里没有'); }
else {
  check('任务入队', true);
  const segNodes = Object.entries(p).filter(([,n]) => n?.class_type === 'AICG3D_H3SequenceSegment');
  check('5 段展开', segNodes.length === 5, `${segNodes.length} 个`);
  const states = segNodes.map(([,n]) => JSON.parse(n.inputs.inline_media_state || '{}'));
  const names = states.map(s => (s.images ?? [])[0]).filter(Boolean);
  check('每段都挂了参考图', names.length === 5, `${names.length} 段有图`);
  check('每段用的是同一张图', new Set(names).size === 1, [...new Set(names)].join(','));
}
await fetch(`${COMFY}/interrupt`,{method:'POST'});
await fetch(APP+'/api/app/projects',{method:'DELETE',headers:H,body:JSON.stringify({projectIds:[proj.id]})});
console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
process.exit(fails.length ? 1 : 0);

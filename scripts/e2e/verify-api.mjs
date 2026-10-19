// @needs: comfyui —— 会真正提交生成任务；CI 无 GPU，跳过这一套

const VERIFY_DIR = process.env.VERIFY_OUT ?? './.verify/';

// 全量验证：后端接口层。
// 每个断言都打出来，失败不中断，最后汇总。
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:3020';
const H = {
  'content-type': 'application/json',
  'x-beatapi-workspace-request': '1',
  origin: APP,
};

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name + (detail ? '  ' + detail : '')); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
};

const get = async (path) => {
  const r = await fetch(APP + path, { headers: { origin: APP } });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j };
};

console.log('\n=== 基础接口 ===');
{
  const r = await get('/api/ping');
  check('ping', r.status === 200, `status=${r.status}`);
}
{
  const r = await get('/api/app/effects/models');
  const list = r.json?.models ?? r.json ?? [];
  check('模型列表', r.status === 200 && list.length === 21, `${list.length} 个`);
  const withDesc = list.filter((m) => m.description);
  check('模型都有说明', withDesc.length === 19, `${withDesc.length}/21（2 个无说明）`);
  const kinds = new Set(list.map((m) => m.workspaceType));
  check('三种 workspaceType', kinds.size === 3, [...kinds].join(','));
}
{
  const r = await get('/api/app/environment');
  const checks = r.json?.checks ?? [];
  const failed = checks.filter((c) => c.status === 'fail');
  check('环境自检', r.status === 200 && failed.length === 0, `${checks.length} 项，失败 ${failed.length}`);
}
{
  const r = await get('/api/app/services');
  check('服务状态接口', r.status === 200, JSON.stringify(r.json).slice(0, 80));
}

console.log('\n=== 项目 CRUD ===');
let projectId = null;
{
  const r = await fetch(APP + '/api/app/projects', { method: 'POST', headers: H, body: JSON.stringify({ name: '全量验证' }) });
  const j = await r.json();
  projectId = j.id;
  check('创建项目', r.ok && !!projectId, projectId?.slice(0, 8));
}
{
  const r = await get('/api/app/projects');
  const list = r.json?.projects ?? r.json ?? [];
  check('项目列表', r.status === 200 && Array.isArray(list), `${list.length} 个`);
  check('新项目在列表里', list.some((p) => p.id === projectId));
}
{
  const r = await get(`/api/app/projects/${projectId}`);
  check('读单个项目', r.status === 200);
}
{
  const r = await get(`/api/app/projects/${projectId}/snapshot`);
  check('项目快照', r.status === 200);
}
{
  const r = await get(`/api/app/projects/${projectId}/generations`);
  check('项目生成记录', r.status === 200);
}
{
  const r = await get(`/api/app/projects/${projectId}/timeline`);
  check('项目时间线', r.status === 200);
}
{
  const r = await get(`/api/app/projects/${projectId}/revision`);
  check('项目版本号', r.status === 200);
}
{
  const r = await get(`/api/app/projects/${projectId}/assets`);
  check('项目素材列表', r.status === 200);
}

console.log('\n=== 生成校验 ===');
{
  const body = { generation: { version: 2, projectId, modelId: '小枫-qwen-image-2-1-文生图', mode: 'image', prompt: '测试', references: [], parameters: {} } };
  const r = await fetch(APP + '/api/effects/precheck', { method: 'POST', headers: H, body: JSON.stringify(body) });
  check('precheck 图生文', r.ok, `status=${r.status}`);
}
{
  // 翻唱缺音频应当被拒
  const body = { generation: { version: 2, projectId, modelId: '小枫-yue2-歌曲翻唱', mode: 'audio', prompt: '[Verse]\n测试', references: [], parameters: {} } };
  const r = await fetch(APP + '/api/effects/generate', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  check('翻唱缺音频被拒', !r.ok, `status=${r.status} ` + (j?.error ?? ''));
}

console.log('\n=== 404 / 越权 ===');
{
  const r = await fetch(APP + '/api/app/projects/00000000-0000-0000-0000-000000000000', { method: 'POST', headers: H, body: '{}' });
  check('POST 不存在的项目返回 404', r.status === 404, `status=${r.status}`);
}
{
  const r = await fetch(APP + '/api/app/projects', { method: 'POST', headers: { origin: APP }, body: '{}' });
  check('缺少防跨站头的写请求被拒', !r.ok, `status=${r.status}`);
}

// 清理
await fetch(APP + '/api/app/projects', { method: 'DELETE', headers: H, body: JSON.stringify({ projectIds: [projectId] }) });
console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) { console.log('失败项:'); fails.forEach((f) => console.log('  - ' + f)); }
process.exit(fails.length ? 1 : 0);

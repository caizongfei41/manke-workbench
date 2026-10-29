// 生成诊断包
//
//   node scripts/make-diagnostic.mjs
//   node scripts/make-diagnostic.mjs --out "D:\我的诊断.md"
//
// 其他电脑出问题时，把产出的一个文件发给 AI，就能定位大部分故障。
//
// 设计原则：
//   1. 一份自包含的 Markdown —— 不需要解压、不需要配套文件，粘贴即可
//   2. 只收环境事实，不收隐私 —— 不抓用户名以外的个人信息，不抓作品内容
//   3. 日志只取尾部关键行 —— 完整日志动辄几十 MB，贴给 AI 反而淹没重点
//   4. 每一项都标注「采集失败」而不是静默跳过 —— 缺失本身也是线索
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * Which workbench are we diagnosing?
 *
 * The console ships a copy of this script under its own install directory,
 * but the actual workbench may live elsewhere. BEATDESIGN_ROOT wins so the
 * button in the console diagnoses the real installation, not the 25 MB shell.
 */
const ROOT = process.env.BEATDESIGN_ROOT?.trim() || join(HERE, '..');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = valueOf('--out') ?? join(ROOT, `诊断报告-${STAMP}.md`);

const lines = [];
const section = (title) => {
  lines.push('', `## ${title}`, '');
};
const kv = (k, v) => {
  lines.push(`- **${k}**：${v === undefined || v === null || v === '' ? '（空）' : v}`);
};
/**
 * Fence with four backticks: log output routinely contains ``` (markdown
 * inside errors, ComfyUI node banners) and three would close the block early.
 */
const code = (text, lang = '') => {
  lines.push('', '````' + lang, String(text).slice(0, 8000), '````', '');
};
const note = (text) => {
  lines.push(`> ${text}`, '');
};

/** Run a command, never throw: a failed probe is itself diagnostic data. */
/**
 * The default console code page here is GBK, so anything PowerShell prints
 * that contains Chinese arrives as mojibake. Force UTF-8 on every powershell
 * invocation rather than patching each call site.
 */
const tryRun = (cmd, cmdArgs, opts = {}) => {
  try {
    const isPwsh = /powershell|pwsh/i.test(cmd);
    const finalArgs = isPwsh
      ? ['-NoProfile', '-NonInteractive', '-Command',
         '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
         cmdArgs[cmdArgs.indexOf('-Command') + 1]]
      : cmdArgs;
    const r = spawnSync(cmd, finalArgs, {
      encoding: 'utf8',
      timeout: opts.timeout ?? 20000,
      windowsHide: true,
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.error) return { ok: false, out: `采集失败：${r.error.message}` };
    const out = `${r.stdout ?? ''}${r.stderr ? `\n[stderr] ${r.stderr}` : ''}`.trim();
    return { ok: r.status === 0, out: out || '（无输出）', status: r.status };
  } catch (error) {
    return { ok: false, out: `采集失败：${error.message}` };
  }
};

/** Read the tail of a log without loading a 30 MB file into memory. */
const tailLog = (path, maxLines = 80) => {
  if (!existsSync(path)) return null;
  try {
    const size = statSync(path).size;
    const take = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(take);
    const fd = openSync(path, 'r');
    readSync(fd, buf, 0, take, size - take);
    closeSync(fd);
    const text = buf.toString('utf8').replace(/^\uFFFD+/, '');
    const all = text.split(/\r?\n/).filter((l) => l.trim());
    return { size, lines: all.slice(-maxLines), truncated: all.length > maxLines };
  } catch (error) {
    return { error: String(error) };
  }
};

const human = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

// ── 头 ──
lines.push(
  '# 漫客工作台 · 诊断报告',
  '',
  `生成时间：${new Date().toLocaleString('zh-CN')}`,
  '',
  '这份文件包含环境信息、服务状态和日志尾部。把它整个发给 AI，配合你的问题描述，'
  + '通常可以直接定位故障。',
  '',
  '**发出去之前看一眼「隐私」一节** —— 里面有这台机器的路径和用户名。'
);

// ── 1. 系统 ──
section('1. 操作系统');
kv('系统', `${os.type()} ${os.release()} (${process.arch})`);
kv('Windows 版本', (() => {
  const r = tryRun('powershell', [
    '-NoProfile',
    '-Command',
    '(Get-CimInstance Win32_OperatingSystem).Caption + " build " + (Get-CimInstance Win32_OperatingSystem).BuildNumber',
  ]);
  return r.out;
})());
kv('主机名', os.hostname());
kv('用户名', os.userInfo().username);
kv('CPU', `${os.cpus().length} 核 · ${os.cpus()[0]?.model ?? '未知'}`);
kv('内存', `${human(os.totalmem())} 总 / ${human(os.freemem())} 可用`);
kv('运行时长', `${(os.uptime() / 3600).toFixed(1)} 小时`);

// ── 2. 显卡 ──
section('2. 显卡与驱动');
const nvsmi = tryRun('nvidia-smi', [
  '--query-gpu=name,driver_version,memory.total,memory.used',
  '--format=csv,noheader',
]);
if (nvsmi.ok) {
  code(nvsmi.out);
} else {
  note('**没有检测到 NVIDIA 显卡或驱动。** ComfyUI 的模型需要 NVIDIA 显卡（建议 20 GB 以上显存）。');
  code(nvsmi.out);
}

// ── 3. 磁盘 ──
section('3. 磁盘空间');
const disks = tryRun('powershell', [
  '-NoProfile',
  '-Command',
  'Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Used -ne $null} | ForEach-Object { "{0}|{1}|{2}" -f $_.Name, $_.Used, $_.Free }',
]);
if (disks.ok) {
  const rows = disks.out.split(/\r?\n/).filter((l) => l.includes('|'));
  lines.push('| 盘 | 已用 | 可用 |', '| --- | ---: | ---: |');
  for (const row of rows) {
    const [name, used, free] = row.split('|');
    const u = Number(used);
    const f = Number(free);
    if (!Number.isFinite(u)) continue;
    lines.push(`| ${name}: | ${human(u)} | ${human(f)} |`);
  }
  lines.push('');
} else {
  code(disks.out);
}

// ── 4. 关键目录 ──
section('4. 安装位置');
kv('工作台目录', ROOT);
kv('控制台目录', join(process.env.LOCALAPPDATA ?? '', 'Programs', '漫客工作台'));

const cfgPath = join(ROOT, 'data', 'comfyui.config.json');
if (existsSync(cfgPath)) {
  kv('ComfyUI 配置', cfgPath);
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
    lines.push('');
    code(JSON.stringify(cfg, null, 2), 'json');
    // 逐一验证配置里提到的路径是否存在 —— 这是最高频的故障点
    const comfyRoot = cfg.comfyRoot ?? (() => {
      const py = String(cfg.pythonPath ?? '');
      const i = py.toLowerCase().indexOf('python_embeded');
      return i > 0 ? py.slice(0, i).replace(/[\\/]+$/, '') : null;
    })();
    if (comfyRoot) {
      kv('ComfyUI 根目录存在', existsSync(comfyRoot) ? `是（${comfyRoot}）` : `**否** —— ${comfyRoot}`);
      const checks = [
        ['main.py', join(comfyRoot, 'main.py')],
        ['ComfyUI/main.py', join(comfyRoot, 'ComfyUI', 'main.py')],
        ['python_embeded/python.exe', join(comfyRoot, 'python_embeded', 'python.exe')],
        ['models', join(comfyRoot, 'models')],
        ['custom_nodes', join(comfyRoot, 'custom_nodes')],
      ];
      lines.push('');
      for (const [name, p] of checks) {
        lines.push(`- ${existsSync(p) ? '✓' : '✗'} ${name}`);
      }
      lines.push('');
    }
  } catch (error) {
    kv('配置解析', `失败：${error.message}`);
  }
} else {
  note(`**配置文件不存在**：${cfgPath}。工作台会用默认路径，通常连不上 ComfyUI。`);
}

// ── 5. 服务状态 ──
section('5. 服务状态');
const probe = async (port, path) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(4000),
    });
    return { up: res.ok, status: res.status };
  } catch (error) {
    return { up: false, error: error.message };
  }
};
const wb = await probe(3020, '/zh');
const cf = await probe(8188, '/system_stats');
kv('工作台 3020', wb.up ? `运行中（HTTP ${wb.status}）` : `未响应${wb.error ? `：${wb.error}` : ''}`);
kv('ComfyUI 8188', cf.up ? `运行中（HTTP ${cf.status}）` : `未响应${cf.error ? `：${cf.error}` : ''}`);

const ports = tryRun('powershell', [
  '-NoProfile',
  '-Command',
  'Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in 3020,8188,8080,8081} | ForEach-Object { "{0}|{1}" -f $_.LocalPort, $_.OwningProcess }',
]);
if (ports.ok && ports.out !== '（无输出）') {
  lines.push('', '端口占用：', '');
  code(ports.out);
}

// ── 6. 计划任务 ──
section('6. 启动任务');
const tasks = tryRun('powershell', [
  '-NoProfile',
  '-Command',
  "Get-ScheduledTask -TaskName 'BD-*' -ErrorAction SilentlyContinue | ForEach-Object { $a=$_.Actions[0]; '{0}|{1}|{2}|{3}' -f $_.TaskName,$_.State,$a.Execute,$a.Arguments }",
]);
if (tasks.ok && tasks.out !== '（无输出）') {
  code(tasks.out);
} else {
  note('没有找到 BD-* 计划任务。控制台可能未安装，或任务被删除。');
}

// ── 7. 环境自检 ──
section('7. 环境自检结果');
const checkScript = join(ROOT, 'scripts', 'check-environment.mjs');
if (existsSync(checkScript)) {
  const r = tryRun(process.execPath, [checkScript, '--json', '--root', ROOT], {
    timeout: 120000,
    cwd: ROOT,
  });
  try {
    const json = JSON.parse(r.out.replace(/^\uFEFF/, ''));
    lines.push(`通过 **${json.summary.pass}** ／ 警告 **${json.summary.warn}** ／ 失败 **${json.summary.fail}**`, '');
    lines.push('| 检查项 | 状态 | 详情 |', '| --- | --- | --- |');
    for (const c of json.checks ?? []) {
      const mark = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗';
      const detail = String(c.detail ?? '').replace(/\|/g, '/').slice(0, 90);
      lines.push(`| ${mark} ${c.label} | ${c.status} | ${detail} |`);
    }
    lines.push('');
    const bad = (json.checks ?? []).filter((c) => c.status !== 'pass');
    if (bad.length) {
      lines.push('**失败的检查项详情：**', '');
      for (const c of bad) {
        lines.push(`### ${c.label}`, '', `- 状态：${c.status}`, `- 详情：${c.detail}`, `- 建议：${c.hint ?? '（无）'}`, '');
      }
    }
  } catch {
    note('自检脚本没有返回可解析的 JSON，原始输出：');
    code(r.out);
  }
} else {
  note(`自检脚本不存在：${checkScript}`);
}

// ── 8. 日志 ──
section('8. 日志尾部');

const logTargets = [
  ['工作台服务端', join(ROOT, 'data', 'logs', 'workbench.err.log')],
  ['工作台输出', join(ROOT, 'data', 'logs', 'workbench.log')],
  ['ComfyUI 错误', join(ROOT, 'data', 'logs', 'comfyui.err.log')],
  ['ComfyUI 输出', join(ROOT, 'data', 'logs', 'comfyui.log')],
  ['控制台', join(process.env.LOCALAPPDATA ?? '', 'Programs', '漫客工作台', 'data', 'logs')],
];

for (const [label, path] of logTargets) {
  if (!existsSync(path)) {
    kv(label, `无日志（${path}）`);
    continue;
  }
  const st = statSync(path);
  if (st.isDirectory()) {
    const newest = readdirSync(path)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ f, t: statSync(join(path, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    if (!newest) continue;
    const tail = tailLog(join(path, newest.f));
    if (tail?.lines) {
      lines.push('', `### ${label}（${newest.f}，${human(tail.size)}）`, '');
      code(tail.lines.join('\n'));
    }
    continue;
  }
  const tail = tailLog(path);
  if (tail?.lines?.length) {
    lines.push('', `### ${label}（${human(tail.size)}${tail.truncated ? '，仅末 80 行' : ''}）`, '');
    code(tail.lines.join('\n'));
  } else if (tail) {
    kv(label, `空文件或无法读取（${tail.error ?? '无内容'}）`);
  }
}

// ── 9. Python 与依赖 ──
section('9. Python 环境');
if (existsSync(cfgPath)) {
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
    const py = String(cfg.pythonPath ?? '').replace(/\s+$/, '');
    if (py && existsSync(py)) {
      const v = tryRun(py, ['-c', 'import sys,torch,torchvision;print(sys.version.split()[0]);print(torch.__version__, torch.cuda.is_available())'], { timeout: 60000 });
      code(v.out);
    } else {
      kv('Python', `不存在：${py || '（未配置）'}`);
    }
  } catch {
    /* already reported above */
  }
}

// ── 10. 隐私 ──
section('10. 隐私提示');
note(
  '这份报告包含：本机用户名、目录路径、显卡型号、磁盘容量、日志内容。'
  + '**不包含**：作品图片、视频、输入过的提示词原文、账号密码、API Key。'
  + '如果要公开贴出，可以把用户名和目录名替换成占位符。'
);

lines.push('', '---', '', '把这份文件整份发给 AI，并补充一句你遇到的具体现象（什么时候、点了什么、看到什么）。', '');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'), 'utf8');
const size = statSync(OUT).size;
console.log(`  诊断报告已生成：${OUT}`);
console.log(`  大小：${human(size)}`);

// 部署包：检查分卷 + 一键全流程部署。
//
// 目标机器上最费时的一步是把 200 GB 的 ComfyUI 和模型装到该去的地方。
// 部署包是一串分卷 manke-bundle.7z.001 … .7z.119，解压 .001 即可（7-Zip 会
// 自动接续后面的卷）。
//
// 两条路：
//
//   inspectBundle  只报告分卷状态，让用户看清楚
//   deployBundle   选一个目录，全自动：检查 → 备空间 → 解压 → 找 ComfyUI 根
//                  → 写配置 → 起服务。只有一个按钮，中间不用再点。
//
// 7-Zip 从哪来：优先程序自带的（打包时和 7z.dll 一起放进 resources），
// 其次系统装的。解 200 GB 分卷自己实现一个解压器不现实。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** 分卷命名：manke-bundle.7z.001。基名由打包脚本决定，这里只认后缀。 */
const VOLUME_RE = /^(.*\.7z)\.\d{3}$/i;

/**
 * 找一个能用的 7z.exe。
 * @param {string} resources 打包后的 resources 目录
 */
const find7z = (resources) => {
  const candidates = [
    path.join(resources, '7z.exe'),
    path.join(path.dirname(resources), '7z.exe'),
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, '7z.exe');
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
};

/** 磁盘剩余空间。Windows 上用 wmic，失败返回 null。 */
const freeSpaceOf = (dir) => {
  try {
    const { execFileSync } = require('node:child_process');
    const drive = path.parse(path.resolve(dir)).root.replace(/\\$/, '');
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -eq '${drive}\\' } | Select-Object -First 1).Free`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 }
    );
    const n = Number(String(out).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

/**
 * 检查一个目录里的部署包分卷。
 *
 * @param {string} dir 分卷所在目录
 */
const inspectBundle = (dir) => {
  const result = {
    ok: false,
    dir,
    base: null,
    volumes: 0,
    totalBytes: 0,
    firstVolume: null,
    missing: [],
    message: '',
  };

  if (!dir || !fs.existsSync(dir)) {
    result.message = '目录不存在';
    return result;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    result.message = `目录读不了：${e && e.message}`;
    return result;
  }

  // 按基名分组，一组就是一套完整的部署包
  const groups = new Map();
  for (const name of entries) {
    const m = name.match(VOLUME_RE);
    if (!m) continue;
    const index = Number(name.slice(name.lastIndexOf('.') + 1));
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push({ name, index });
  }

  if (groups.size === 0) {
    result.message = '目录里没有 .7z.001 分卷';
    return result;
  }

  // 取分卷最多的那一组
  let base = null;
  let volumes = [];
  for (const [b, list] of groups) {
    if (list.length > volumes.length) {
      base = b;
      volumes = list;
    }
  }

  volumes.sort((a, b) => a.index - b.index);

  let total = 0;
  for (const v of volumes) {
    try {
      total += fs.statSync(path.join(dir, v.name)).size;
    } catch {
      /* ignore */
    }
  }

  // 从 1 到最大编号，找缺哪几卷
  const maxIndex = volumes[volumes.length - 1].index;
  const present = new Set(volumes.map((v) => v.index));
  const missing = [];
  for (let i = 1; i <= maxIndex; i += 1) {
    if (!present.has(i)) missing.push(i);
  }

  const gb = (total / 1024 ** 3).toFixed(1);
  Object.assign(result, {
    ok: missing.length === 0,
    base,
    volumes: volumes.length,
    totalBytes: total,
    firstVolume: path.join(dir, `${base}.001`),
    missing,
    message:
      missing.length === 0
        ? `分卷齐全：${volumes.length} 个 · ${gb} GB`
        : `缺 ${missing.length} 个分卷（第 ${missing.slice(0, 6).join('、')}${missing.length > 6 ? '…' : ''} 卷）`,
  });
  return result;
};

/**
 * 解压部署包。
 *
 * @param {object} opts
 * @param {string} opts.firstVolume  .7z.001 的完整路径
 * @param {string} opts.targetDir    解到哪
 * @param {string} opts.resources    resources 目录，用来找随包 7z.exe
 * @param {(p:{percent:number,line:string})=>void} [opts.onProgress]
 * @returns {Promise<{ok:boolean, targetDir:string, comfyRoot:string|null, message:string}>}
 */
const extractBundle = ({ firstVolume, targetDir, resources, onProgress }) =>
  new Promise((resolve) => {
    const sevenZip = find7z(resources);
    if (!sevenZip) {
      resolve({
        ok: false,
        targetDir,
        comfyRoot: null,
        message: '没有找到 7z.exe。这个构建没有内置解压组件，请反馈。',
      });
      return;
    }
    if (!firstVolume || !fs.existsSync(firstVolume)) {
      resolve({
        ok: false,
        targetDir,
        comfyRoot: null,
        message: `分卷不存在：${firstVolume}`,
      });
      return;
    }

    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      resolve({
        ok: false,
        targetDir,
        comfyRoot: null,
        message: `目标目录建不了：${e && e.message}`,
      });
      return;
    }

    // -bsp1 把百分比打到 stdout，好做进度条；-y 覆盖不提问
    const child = spawn(sevenZip, ['x', '-bsp1', '-y', `-o${targetDir}`, firstVolume], {
      windowsHide: true,
      cwd: path.dirname(firstVolume),
    });

    let lastPercent = 0;
    let lastLine = '';
    const handle = (chunk) => {
      const text = chunk.toString();
      const m = text.match(/(\d{1,3})%/);
      if (m) {
        const percent = Math.min(100, Number(m[1]));
        if (percent !== lastPercent) {
          lastPercent = percent;
          lastLine = text.trim().split('\n').pop() ?? '';
          onProgress?.({ percent, line: lastLine });
        }
      } else {
        const line = text.trim().split('\n').pop();
        if (line) {
          lastLine = line;
          onProgress?.({ percent: lastPercent, line: lastLine });
        }
      }
    };

    child.stdout?.on('data', handle);
    child.stderr?.on('data', handle);

    child.on('error', (e) => {
      resolve({ ok: false, targetDir, comfyRoot: null, message: String(e && e.message) });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          targetDir,
          comfyRoot: null,
          message: `解压失败（7-Zip 退出码 ${code}）：${lastLine}`,
        });
        return;
      }

      onProgress?.({ percent: 100, line: '' });

      // 部署包可能解成 <target>/manke，也可能直接是 <target>/ComfyUI
      const candidates = [
        targetDir,
        path.join(targetDir, 'manke'),
        path.join(targetDir, 'ComfyUI'),
        path.join(targetDir, 'manke', 'ComfyUI'),
      ];
      const found = candidates.find((p) =>
        fs.existsSync(path.join(p, 'python_embeded', 'python.exe'))
      );

      resolve({
        ok: Boolean(found),
        targetDir,
        comfyRoot: found ?? null,
        message: found
          ? `解压完成：${found}`
          : '解压完成，但没有 python_embeded\\python.exe —— 部署包可能不完整。',
      });
    });
  });

/**
 * 一键部署：检查 → 备空间 → 解压 → 返回 ComfyUI 根。
 *
 * 调用方拿到 comfyRoot 后自己写配置、起服务。这里只管把文件放到该去的地方。
 */
const deployBundle = async ({ dir, targetDir, resources, onProgress }) => {
  onProgress?.({ phase: 'inspect', percent: 0, message: '检查分卷…' });

  const inspected = inspectBundle(dir);
  if (!inspected.ok) {
    return { ok: false, comfyRoot: null, message: inspected.message };
  }

  // 空间检查：解压出来大约是分卷总量的 1.05 倍
  const need = inspected.totalBytes * 1.05;
  const free = freeSpaceOf(targetDir);
  if (free !== null && free < need) {
    return {
      ok: false,
      comfyRoot: null,
      message: `目标盘空间不够：需要约 ${(need / 1024 ** 3).toFixed(0)} GB，可用 ${(free / 1024 ** 3).toFixed(0)} GB`,
    };
  }

  onProgress?.({ phase: 'extract', percent: 0, message: '开始解压…' });

  const extracted = await extractBundle({
    firstVolume: inspected.firstVolume,
    targetDir,
    resources,
    onProgress: (p) => {
      onProgress?.({ phase: 'extract', percent: p.percent, message: p.line });
    },
  });

  return { ok: extracted.ok, comfyRoot: extracted.comfyRoot, message: extracted.message };
};

module.exports = { find7z, freeSpaceOf, inspectBundle, extractBundle, deployBundle };

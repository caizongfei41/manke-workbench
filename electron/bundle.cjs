// 部署包：检查分卷 + 一键解压。
//
// 目标机器上最费时的一步是把 211 GB 的 ComfyUI 和模型装到该去的地方。
// 部署包是一串分卷 manke-bundle.7z.001 … .7z.119，解压 .001 即可（7-Zip 会
// 自动接续后面的卷）。旧控制台把这件事做成了两个按钮，这里复刻成 IPC：
//
//   bundle:inspect  列出分卷、算总量、判断齐不齐
//   bundle:extract  调 7-Zip 解压到目标目录，边解边报进度
//
// 7-Zip 从哪来：程序旁边如果有 7z.exe 就用它；否则用系统装的。
// 都不行就让用户去装 —— 解 200 GB 的分卷，自己实现一个解压器不现实。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** 分卷命名：manke-bundle.7z.001。基名由打包脚本决定，这里只认前缀。 */
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
  // PATH 上的 7z
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

/**
 * 检查一个目录里的部署包分卷。
 *
 * @param {string} dir 分卷所在目录
 * @returns {{ok:boolean, dir:string, base:string|null, volumes:number,
 *            totalBytes:number, firstVolume:string|null, missing:number[],
 *            message:string}}
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
 * @returns {Promise<{ok:boolean, targetDir:string, message:string}>}
 */
const extractBundle = ({ firstVolume, targetDir, resources, onProgress }) =>
  new Promise((resolve) => {
    const sevenZip = find7z(resources);
    if (!sevenZip) {
      resolve({
        ok: false,
        targetDir,
        message:
          '没有找到 7z.exe。请安装 7-Zip（https://www.7-zip.org/），或把 7z.exe 放到程序目录下。',
      });
      return;
    }
    if (!firstVolume || !fs.existsSync(firstVolume)) {
      resolve({ ok: false, targetDir, message: `分卷不存在：${firstVolume}` });
      return;
    }

    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      resolve({ ok: false, targetDir, message: `目标目录建不了：${e && e.message}` });
      return;
    }

    // -bsp1 把百分比打到 stdout，好做进度条；-y 覆盖不提问
    const child = spawn(sevenZip, ['x', '-bsp1', '-y', `-o${targetDir}`, firstVolume], {
      windowsHide: true,
      cwd: path.dirname(firstVolume),
    });

    let lastPercent = 0;
    const handle = (chunk) => {
      const text = chunk.toString();
      // 7z 的进度形如 " 12% 5 - filename"
      const m = text.match(/(\d{1,3})%/);
      if (m) {
        const percent = Math.min(100, Number(m[1]));
        if (percent !== lastPercent) {
          lastPercent = percent;
          onProgress?.({ percent, line: text.trim().split('\n').pop() ?? '' });
        }
      }
    };

    child.stdout?.on('data', handle);
    child.stderr?.on('data', handle);

    child.on('error', (e) => {
      resolve({ ok: false, targetDir, message: String(e && e.message) });
    });

    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.({ percent: 100, line: '' });

        // 解压出来的结构可能是 <target>/manke 或者直接是 <target>/ComfyUI
        const candidates = [
          path.join(targetDir, 'manke'),
          targetDir,
          path.join(targetDir, 'ComfyUI'),
        ];
        const found = candidates.find((p) =>
          fs.existsSync(path.join(p, 'python_embeded', 'python.exe'))
        );
        resolve({
          ok: true,
          targetDir: found ?? targetDir,
          message: found
            ? `解压完成：${found}`
            : '解压完成，但没找到 python_embeded\\python.exe，请检查部署包内容。',
        });
      } else {
        resolve({ ok: false, targetDir, message: `7-Zip 退出码 ${code}` });
      }
    });
  });

module.exports = { find7z, inspectBundle, extractBundle };

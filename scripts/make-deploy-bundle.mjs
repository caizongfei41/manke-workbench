// 一键部署包 · 打包端
//
//   node scripts/make-deploy-bundle.mjs --plan        看一眼要打什么、分几卷
//   node scripts/make-deploy-bundle.mjs --make        开始打包（分卷）
//   node scripts/make-deploy-bundle.mjs --make --part=1  只打某一类
//
// 为什么分卷：
//   模型 197 GB，任何一块盘都放不下完整压缩包。夸克单文件上限 1.9 GB，
//   所以按 1.9 GB 切卷，打完一卷就能传，传完删掉腾空间。
//
// 为什么用 -mx0：
//   safetensors 是已压缩的浮点权重，再压一遍几乎不减体积，只是白烧 CPU。
//   -mx0 只做容器打包，速度受限于磁盘读（本机实测 550 MB/s）。
//
// 产出的分卷按「类别」分开，这样新机器上可以只下需要的部分：
//   01-models.7z.001…   模型
//   02-nodes.7z.001…    自定义节点包
//   03-app.7z.001…      工作台源码（含 .output 构建产物）
//   04-runtime.7z.001…  便携 Node（可选）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MANIFEST = join(ROOT, 'docs/DEPENDENCIES.json');
const CONFIG = join(ROOT, 'data/comfyui.config.json');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const SEVEN_ZIP = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].find(
  (p) => existsSync(p)
);
if (!SEVEN_ZIP) {
  console.error('  找不到 7z.exe，请先安装 7-Zip');
  process.exit(1);
}

const resolveComfyRoot = () => {
  if (process.env.BEATDESIGN_COMFYUI_HOME) return process.env.BEATDESIGN_COMFYUI_HOME;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const py = String(cfg.pythonPath ?? '');
    const idx = py.toLowerCase().indexOf('python_embeded');
    if (idx > 0) return py.slice(0, idx).replace(/[\\/]+$/, '');
  } catch {
    /* fall through */
  }
  return 'E:\\ComfyUI';
};
const COMFY_DIR = join(resolveComfyRoot(), 'ComfyUI');

/** 分卷大小：夸克单文件上限 1.9 GB，留点余量。 */
const VOLUME = process.env.BEATDESIGN_VOLUME ?? '1800m';
/** 输出目录：必须跟源在同一个盘才不占额外空间做硬链接；这里直接写到指定盘。 */
const OUT = process.env.BEATDESIGN_DEPLOY_DIR ?? 'G:\\manke-deploy';

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};
const manifest = readJson(MANIFEST, { files: [] });

/** 在 models/ 下按文件名索引。 */
const indexModels = () => {
  const map = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!map.has(entry.name)) map.set(entry.name, full);
    }
  };
  walk(join(COMFY_DIR, 'models'));
  return map;
};

const human = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

/** 按类别列出要打包的路径。 */
const buildParts = () => {
  const index = indexModels();
  const modelFiles = [];
  const seen = new Set();
  for (const file of manifest.files ?? []) {
    const hit = index.get(file.basename);
    if (!hit || seen.has(hit)) continue;
    seen.add(hit);
    modelFiles.push(hit);
  }
  const modelBytes = modelFiles.reduce((sum, f) => sum + statSync(f).size, 0);

  // 节点包：只带清单里要求的 13 个，其余是历史噪音
  const sources = readJson(join(ROOT, 'data/install-sources.json'), { nodes: {} });
  const wantedNodes = Object.keys(sources.nodes ?? {});
  const nodeDirs = wantedNodes
    .map((name) => join(COMFY_DIR, 'custom_nodes', name))
    .filter((p) => existsSync(p));
  const nodeBytes = nodeDirs.reduce((sum, dir) => {
    const walk = (d) => {
      let total = 0;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === '__pycache__') continue;
        const full = join(d, e.name);
        try {
          total += e.isDirectory() ? walk(full) : statSync(full).size;
        } catch {
          /* 读不到就跳过 */
        }
      }
      return total;
    };
    return sum + walk(dir);
  }, 0);

  const parts = [
    { id: '01-models', label: '模型', kind: 'models', paths: modelFiles, bytes: modelBytes },
    { id: '02-nodes', label: '自定义节点包', kind: 'dirs', paths: nodeDirs, bytes: nodeBytes },
    {
      id: '03-app',
      label: '工作台源码',
      kind: 'app',
      // 只打真正需要的：源码、数据、文档、配置、启动器。
      // 不打 node_modules（新机器 pnpm install 更快）、.verify（构建产物和临时文件）、
      // .git（历史无关）、data/trash（用户删过的垃圾）、data/project-assets（用户素材）。
      paths: ['src', 'scripts', 'messages', 'public', 'docs', 'launcher', 'drizzle', 'data/comfyui', 'data/comfyui.config.json',
              'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'vite.config.ts',
              'drizzle.config.ts', 'README.md', 'AGENTS.md', 'CHANGELOG.md', '.gitignore', '.npmrc']
        .map((p) => join(ROOT, p))
        .filter((p) => existsSync(p)),
      bytes: 0,
    },
  ];

  // 源码大小：按上面列出的路径算
  const measurePath = (p) => {
    try {
      if (!statSync(p).isDirectory()) return statSync(p).size;
    } catch {
      return 0;
    }
    let total = 0;
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (['node_modules', '.git', '.verify', '.tanstack', '.nitro', '__pycache__'].includes(e.name)) continue;
      total += measurePath(join(p, e.name));
    }
    return total;
  };
  parts[2].bytes = parts[2].paths.reduce((sum, p) => sum + measurePath(p), 0);

  // ── 04 便携 ComfyUI
  // 新机器不该再让用户自己装 ComfyUI、配 Python、pip 一堆依赖。
  // 把 python_embeded（含 torch / sage-attention / 各节点包依赖）和 ComfyUI 本体
  // 一起打进来，解压即用。模型和节点在 01/02 里，这里排除它们，避免重复打包 200 GB。
  const comfyRoot = resolveComfyRoot();
  const pyDir = join(comfyRoot, 'python_embeded');
  const comfyCore = join(comfyRoot, 'ComfyUI');

  /** ComfyUI 本体不含 model / output / custom_nodes / input / temp —— 那些在别的分卷里。 */
  const COMFY_EXCLUDE = new Set(['models', 'output', 'custom_nodes', 'input', 'temp', '__pycache__', 'user', 'logs']);
  const measureComfyCore = (dir, depth = 0) => {
    let total = 0;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const e of entries) {
      if (COMFY_EXCLUDE.has(e.name)) continue;
      const full = join(dir, e.name);
      try {
        total += e.isDirectory() ? measureComfyCore(full, depth + 1) : statSync(full).size;
      } catch {
        /* 读不到跳过 */
      }
    }
    return total;
  };

  if (existsSync(pyDir) || existsSync(comfyCore)) {
    const portableBytes =
      (existsSync(pyDir) ? measurePath(pyDir) : 0) +
      (existsSync(comfyCore) ? measureComfyCore(comfyCore) : 0);
    parts.push({
      id: '04-comfyui',
      label: '便携 ComfyUI',
      kind: 'comfyui',
      paths: [...(existsSync(pyDir) ? [pyDir] : []), ...(existsSync(comfyCore) ? [comfyCore] : [])],
      bytes: portableBytes,
      base: comfyRoot,
      exclude: [...COMFY_EXCLUDE],
    });
  }

  return { parts, modelFiles, nodeDirs };
};

const main = () => {
  const { parts, modelFiles, nodeDirs } = buildParts();
  const totalBytes = parts.reduce((sum, p) => sum + p.bytes, 0);

  if (!has('--make')) {
    console.log(`  ComfyUI: ${COMFY_DIR}`);
    console.log(`  输出目录: ${OUT}`);
    console.log(`  分卷大小: ${VOLUME}（夸克单文件上限 1.9 GB）`);
    console.log('');
    console.log(`  总计 ${human(totalBytes)}，分 ${parts.length} 类：`);
    for (const p of parts) {
      console.log(
        `   ${p.id.padEnd(12)} ${p.label.padEnd(12)} ${human(p.bytes).padStart(9)}  ` +
          `约 ${Math.ceil(p.bytes / (1800 * 1024 * 1024))} 卷`
      );
    }
    console.log('');
    if (modelFiles.length === 0) console.log('  ⚠ 没找到模型文件，检查 DEPENDENCIES.json 与 ComfyUI 路径');
    if (nodeDirs.length === 0) console.log('  ⚠ 没找到节点包目录');
    console.log('  开始打包：node scripts/make-deploy-bundle.mjs --make');
    console.log('  只打某类：node scripts/make-deploy-bundle.mjs --make --part=02-nodes');
    return;
  }

  const only = valueOf('--part');
  const picks = only ? parts.filter((p) => p.id === only) : parts;
  if (picks.length === 0) {
    console.log(`  没有匹配 --part=${only} 的类别`);
    return;
  }

  mkdirSync(OUT, { recursive: true });

  for (const part of picks) {
    if (part.bytes === 0) {
      console.log(`  ${part.id}: 没有可打包的内容，跳过`);
      continue;
    }
    const archive = join(OUT, `${part.id}.7z`);
    console.log('');
    console.log(`  ── ${part.id} · ${part.label} · ${human(part.bytes)}`);
    console.log(`     输出 ${archive}.001 …`);

    // 基准目录：
    //   模型 / 节点 → COMFY_DIR（那层下面直接是 models/ 和 custom_nodes/）
    //   便携 ComfyUI → comfyRoot（包内应是 python_embeded/ 和 ComfyUI/）
    //   源码 → 工作台根
    // 用错基准会多打一层目录，还原时铺错位置。
    const baseDir =
      part.id === '04-comfyui'
        ? resolve(part.base)
        : part.id === '01-models' || part.id === '02-nodes'
          ? resolve(COMFY_DIR)
          : resolve(ROOT);
    const relPaths = part.paths
      .map((p) => relative(baseDir, resolve(p)))
      .filter((p) => p && !p.startsWith('..'));
    if (relPaths.length === 0) {
      console.log(`  ${part.id}: 路径不在基准目录下，跳过`);
      continue;
    }

    const listFile = join(OUT, `.${part.id}.list`);
    // ComfyUI 本体要排除 models/output 等，用 7z 的 -xr! 递归排除
    const excludes = (part.exclude ?? []).flatMap((name) => [`-xr!${name}`]);
    writeFileSync(listFile, relPaths.join('\r\n'), 'utf8');

    try {
      const output = execFileSync(
        SEVEN_ZIP,
        [
          'a',
          '-mx0', // 只打包不压缩：权重已是压缩格式
          '-t7z',
          `-v${VOLUME}`,
          ...excludes,
          archive,
          `@${listFile}`,
        ],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: baseDir }
      );
      const tail = output.trim().split('\n').slice(-3).join(' ').trim();
      console.log(`     ${tail}`);
    } catch (error) {
      console.error(`     失败: ${String(error).slice(0, 200)}`);
    } finally {
      try {
        unlinkSync(listFile);
      } catch {
        /* ignore */
      }
    }
  }

  // 写一份还原说明
  const readme = [
    '# 漫客工作台 · 一键部署包',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '## 怎么部署',
    '',
    '把本目录整个拷到新机器，双击运行控制台，点「部署」即可自动检索、解压、铺好。',
    '',
    '手工部署：按编号顺序解压到对应位置',
    '',
    '| 包 | 解压到 |',
    '| --- | --- |',
    '| 01-models.7z.001 | `<ComfyUI>/ComfyUI/`（会落进 models/） |',
    '| 02-nodes.7z.001 | `<ComfyUI>/ComfyUI/custom_nodes/` |',
    '| 03-app.7z.001 | 任意位置，作为工作台根目录 |',
    '',
    '分卷必须**全部下齐**再解压第一卷，7-Zip 会自动接续 002、003…',
    '',
  ].join('\n');
  writeFileSync(join(OUT, '部署说明.md'), readme, 'utf8');

  const volumes = readdirSync(OUT).filter((f) => /\.7z\.\d+$/.test(f));
  const outBytes = volumes.reduce((sum, f) => sum + statSync(join(OUT, f)).size, 0);
  console.log('');
  console.log(`  完成：${volumes.length} 个分卷，合计 ${human(outBytes)}`);
  console.log(`  目录：${OUT}`);
};

main();

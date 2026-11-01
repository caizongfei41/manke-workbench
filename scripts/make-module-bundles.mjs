// 按模块打包部署包。
//
//   node scripts/make-module-bundles.mjs --plan     只算体积，不打包
//   node scripts/make-module-bundles.mjs --build    真的打包
//   node scripts/make-module-bundles.mjs --build --only 01-python
//
// 产物：dist-bundles/01-python.7z、02-comfyui.7z ……，外加一份 manifest.json，
// 描述每个包的 id、大小、sha256、解压目标和顺序。工作台靠 manifest 决定
// 下哪个、解哪个、解完删哪个。
//
// 为什么不用 7z 分卷而是独立包：
//
// 分卷是一个档案切成的若干段，少一段整包就解不开，用户必须同时留着全部
// 7 段才能开始解压 —— 磁盘峰值等于 211 GB 压缩包 + 211 GB 解压结果。
// 独立包每解完一个就能删，峰值只有最大的那个包。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// 输出目录默认在项目下，但 256 GB 的包放不进 C 盘 —— 用 --out 指到别的盘，
// 打完一个传网盘、删本地、再打下一个。
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : join(ROOT, 'dist-bundles');
const TMP = join(ROOT, '.bundle-tmp');
const PARTS_FILE = join(ROOT, 'scripts', 'bundle-parts.yml');

const args = process.argv.slice(2);
const doBuild = args.includes('--build');
const onlyIdx = args.indexOf('--only');
const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const GB = (b) => (b / 1024 ** 3).toFixed(1);
const human = (b) => (b > 1024 ** 3 ? `${GB(b)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`);

/** 极简 YAML 解析：只认这个文件里用到的结构，不引第三方依赖。 */
const parseParts = (text) => {
  const lines = text.split(/\r?\n/);
  const meta = {};
  const parts = [];
  let current = null;
  let listKey = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.trim().startsWith('#')) continue;

    // 顶层 key: value
    if (/^\w+:/.test(line) && !line.startsWith(' ')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) {
        meta[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        current = null;
        listKey = null;
      }
      continue;
    }

    // 新的 part 起点
    if (/^\s+-\s+id:/.test(line)) {
      const m = line.match(/id:\s*'?([^'"]+)'?/);
      current = { id: m[1], dirs: [], files: [], excludes: [] };
      parts.push(current);
      listKey = null;
      continue;
    }

    if (!current) continue;

    // part 内的字段
    const kv = line.match(/^\s+(\w+):\s*(.*)$/);
    if (kv && !line.trim().startsWith('- ')) {
      const [, key, value] = kv;
      if (key === 'dirs' || key === 'files' || key === 'excludes') {
        listKey = key;
      } else {
        current[key] = value.replace(/^['"]|['"]$/g, '');
        listKey = null;
      }
      continue;
    }

    // part 内的列表项
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) {
      current[listKey].push(item[1].replace(/^['"]|['"]$/g, ''));
    }
  }

  return { meta, parts };
};

const sizeOf = (p) => {
  let total = 0;
  let count = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          total += statSync(full).size;
          count += 1;
        } catch {
          /* skip */
        }
      }
    }
  };
  try {
    const st = statSync(p);
    if (st.isFile()) return { bytes: st.size, count: 1 };
  } catch {
    return { bytes: 0, count: 0 };
  }
  walk(p);
  return { bytes: total, count };
};

// Windows 的文件名不区分大小写，配置里写 MiniMax 而磁盘上是 Minimax 时，
// 逐字符比较会漏掉 —— excludes 失效，同一个 31.7 GB 的模型就进了两个包。
// 统一转小写再比。
const matchesAny = (rel, patterns) => {
  const r = rel.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.replace(/\\/g, '/').toLowerCase();
    if (p.endsWith('/**')) return r.startsWith(p.slice(0, -2));
    return r === p || r.startsWith(p + '/');
  });
};

/** 把一个 part 的相对路径清单摊平出来（含 excludes 过滤）。
 *
 * 空目录也要收进来。ComfyUI 的 models/ 下有几十个空目录（checkpoints、
 * loras、vae……），它们是加载器的注册路径 —— 目录不存在，模型列表就是空的。
 * 7z 的 -i@清单 只装列出来的项，所以空目录必须显式写进清单，末尾不带斜杠，
 * 7z 才会当成目录条目打包（带 /* 反而变成"目录下的文件"）。
 */
const resolvePart = (part, source) => {
  const out = [];
  const pushDir = (dirRel) => {
    const abs = join(source, dirRel);
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        const rel = relative(source, full).replace(/\\/g, '/');
        if (e.isDirectory()) {
          // 目录一律进来看看，excludes 只过滤文件。
          //
          // models 骨架就是这么来的：`ComfyUI/models/**` 排掉了所有模型文件，
          // 但 models/vae、models/loras 这些空目录必须留在包里 —— ComfyUI 的
          // 加载器按目录注册路径，目录不存在，模型列表就是空的。
          let childCount = 0;
          try {
            childCount = readdirSync(full).length;
          } catch {
            /* 读不了就当非空 */
          }
          if (childCount === 0) out.push({ rel, isDir: true });
          walk(full);
        } else {
          if (matchesAny(rel, part.excludes)) continue;
          out.push({ rel, isDir: false });
        }
      }
    };
    walk(abs);
  };

  for (const dir of part.dirs ?? []) pushDir(dir);

  for (const file of part.files ?? []) {
    const rel = file.replace(/\\/g, '/');
    const full = join(source, rel);
    if (!existsSync(full)) {
      console.warn(`    缺少文件：${rel}`);
      continue;
    }
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      /* 当文件处理 */
    }

    // excludes 过滤只对文件生效。
    //
    // 两处都需要它：07 包靠 excludes 把已经被 03/04/05 认领的模型剔掉，否则
    // 同一个文件进两个包；而 02 包显式列出的 models 子目录（checkpoints、
    // vae……）恰恰要被 `ComfyUI/models/**` 覆盖 —— 目录留下、里面的模型文件
    // 不要。按路径一律过滤的话目录也没了，ComfyUI 就注册不到加载路径。
    if (!isDir && matchesAny(rel, part.excludes)) continue;

    out.push({ rel, isDir });
  }

  // 去重：目录和 files 可能重叠。按 rel 去重，目录条目优先保留。
  const seen = new Map();
  for (const item of out) {
    const key = item.rel.toLowerCase();
    if (!seen.has(key) || item.isDir) seen.set(key, item);
  }
  return [...seen.values()];
};

// 流式算 sha256。
//
// readFileSync 一次性把整个文件读进 Buffer，Node 的 Buffer 上限 2 GiB ——
// 31.7 GB 的模型包直接抛 ERR_FS_FILE_TOO_LARGE。按块喂养哈希，内存恒定
// 几十 MB，几百 GB 也照算。
const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file, { highWaterMark: 8 * 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

const main = async () => {
  const { meta, parts } = parseParts(readFileSync(PARTS_FILE, 'utf8'));
  const source = meta.source;
  const archiveBase = meta.archiveBase ?? 'bundle';

  console.log(`  源目录: ${source}`);
  console.log(`  分件数: ${parts.length}`);
  console.log('');

  const plan = [];

  for (const part of parts) {
    if (onlyId && part.id !== onlyId) continue;

    const files = resolvePart(part, source);
    let bytes = 0;
  for (const f of files) {
    if (f.isDir) continue; // 目录不占体积
    try {
      bytes += statSync(join(source, f.rel)).size;
    } catch {
      /* skip */
    }
  }
    plan.push({ part, files, bytes });
    console.log(
      `  ${part.id.padEnd(20)} ${part.name.padEnd(14)} ${human(bytes).padStart(9)}  ${files.length} 个文件`
    );
  }

  const totalBytes = plan.reduce((s, p) => s + p.bytes, 0);
  const maxBytes = Math.max(...plan.map((p) => p.bytes));
  console.log('');
  console.log(`  合计: ${human(totalBytes)}`);
  console.log(`  最大单包: ${human(maxBytes)}  ← 磁盘峰值由它决定`);

  // 覆盖完整性检查：所有 part 加起来应该接近源目录（除了排除的 output/temp）
  const sourceTotal = sizeOf(source).bytes;
  const outSize = sizeOf(join(source, 'ComfyUI', 'output')).bytes;
  const expected = sourceTotal - outSize;
  const covered = (totalBytes / expected) * 100;
  console.log(`  源: ${human(sourceTotal)}（output 除外 ${human(expected)}）`);
  console.log(`  覆盖: ${covered.toFixed(1)}%`);
  if (covered < 95) {
    console.log(`  ! 有 ${human(expected - totalBytes)} 没有归到任何包`);
  }

  if (!doBuild) {
    console.log('');
    console.log('  （只做计划。加 --build 真正打包）');
    return;
  }

  // ── 打包
  console.log('');
  console.log('  开始打包…');
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const sevenZip = (() => {
    for (const p of [
      join(ROOT, 'build-resources', '7z.exe'),
      'C:\\Program Files\\7-Zip\\7z.exe',
      'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    ]) {
      if (existsSync(p)) return p;
    }
    return null;
  })();
  if (!sevenZip) {
    console.error('  找不到 7z.exe');
    process.exit(1);
  }

  // 读已有 manifest 做基底。
  //
  // 256 GB 的包放不进一块盘，只能分批打：打完一个传网盘、删本地、再打下一个。
  // 那样每次启动都要从空 manifest 开始，前几批的记录就丢了 —— 工作台拿到的
  // 清单里只有最后打的那个包。
  const manifestPath = join(OUT, 'manifest.json');
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      return null;
    }
  })();

  const manifest = {
    version: 1,
    archiveBase,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    parts: Array.isArray(previous?.parts) ? previous.parts : [],
  };
  if (manifest.parts.length) {
    console.log(`  已有 manifest: ${manifest.parts.length} 个包`);
  }

  // --register-only: hash the archives that already exist, build nothing new.
  // Needed for batch packing: 145 GB of archives may already be done and the
  // disk may not fit the next one, but the manifest still has to be complete.
  const registerOnly = args.includes('--register-only');

  for (const { part, files, bytes } of plan) {
    const archive = join(OUT, part.id + '.7z');
    if (registerOnly && !existsSync(archive)) continue;
    if (existsSync(archive) && !registerOnly) {
      console.log(`  跳过（已存在）: ${part.id}`);
    } else if (!existsSync(archive)) {
      console.log(`  打包 ${part.id}（${human(bytes)}, ${files.filter((f) => !f.isDir).length} 文件）…`);

      // 用 -i@列表文件 只装清单里的文件，避免临时复制（211 GB 复制不起）
      const listFile = join(TMP, `${part.id}.txt`);
      mkdirSync(TMP, { recursive: true });
      // 目录条目和文件条目一起写进清单：7z 的 -i@ 对不带斜杠的路径会当作
      // 目录条目处理，从而在包里保留空目录结构。
      writeFileSync(
        listFile,
        files.map((f) => (f.isDir ? f.rel : f.rel)).join('\r\n'),
        'utf8'
      );

      const t0 = Date.now();
      try {
        // -mx1：大模型是压缩过的二进制，mx9 只浪费时间
        //
        // -xr! 排除：清单里列目录条目时 7z 会递归整个目录。models 的骨架目录
        // （vae、checkpoints……）在源目录里有模型文件，不排除的话 02 包会从
        // 1 GB 涨到 75 GB。这里只对 isDir 的条目加排除，把它们打成空目录。
        const dirExcludes = files
          .filter((f) => f.isDir)
          .map((f) => '-xr!' + f.rel + '\\*');

        execFileSync(
          sevenZip,
          ['a', '-t7z', '-mx1', '-bsp1', archive, `-i@${listFile}`, ...dirExcludes],
          { cwd: source, stdio: 'inherit' }
        );
      } catch (e) {
        console.error(`  打包失败 ${part.id}: ${e.message}`);
        process.exit(1);
      }
      const sec = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`    完成，耗时 ${sec} 秒`);
      if (process.env.DUMP_LIST) {
        const dirs = files.filter((f) => f.isDir).map((f) => f.rel);
        console.log('    DUMP_LIST 目录条目 ' + dirs.length + ' 个');
        for (const d of dirs.slice(0, 10)) console.log('      ' + d);
      }
    }

    const archiveSize = statSync(archive).size;
    console.log(`    计算 sha256…`);
    const digest = await sha256(archive);

    // 同一 id 只留一条 —— --only 分次打包时这里是更新而不是追加
    manifest.parts = manifest.parts.filter((p) => p.id !== part.id);
    manifest.parts.push({
      id: part.id,
      name: part.name,
      label: part.label,
      order: Number(part.order ?? manifest.parts.length + 1),
      file: `${part.id}.7z`,
      bytes: archiveSize,
      sha256: digest,
      fileCount: files.filter((f) => !f.isDir).length,
      // 每个包都解到目标根，目录结构在包里
      extractTo: '.',
    });

    // 每算完一个就落盘一次。
    //
    // 之前只在循环结束后写，中途任何一个包打包失败（比如磁盘满了）就
    // process.exit，前面所有包已经算好的 sha256 全白费 —— 重来一遍得再哈希
    // 一百多 GB。写一份几十 KB 的 JSON 不值得省。
    manifest.parts.sort((a, b) => a.order - b.order);
    manifest.totalBytes = manifest.parts.reduce((s, p) => s + p.bytes, 0);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  // 最终再写一次（--plan 模式没有循环内的写入）
  manifest.parts.sort((a, b) => a.order - b.order);
  manifest.totalBytes = manifest.parts.reduce((s, p) => s + p.bytes, 0);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  rmSync(TMP, { recursive: true, force: true });

  console.log('');
  console.log('  === 产物 ===');
  for (const p of manifest.parts) {
    console.log(`  ${p.id.padEnd(20)} ${(p.bytes / 1024 ** 3).toFixed(1).padStart(6)} GB  ${p.file}`);
  }
  console.log(`  ${'合计'.padEnd(20)} ${(manifest.totalBytes / 1024 ** 3).toFixed(1).padStart(6)} GB`);
  console.log('');
  console.log(`  manifest: ${join(OUT, 'manifest.json')}`);
};

await main();
#!/usr/bin/env node
// 应用工作台更新
//
//   node scripts/apply-update.mjs --root "C:\path\to\workbench"
//   node scripts/apply-update.mjs --root "..." --ref <commit>
//
// 流程：下载 tarball → 备份代码 → 覆盖 → pnpm install → pnpm build → 失败回滚
//
// 只覆盖代码目录。data\（用户的作品、素材、ComfyUI 配置）永远不动。
//
// 为什么不用 src/core/update/workbench-update.ts：
//   那个文件是给工作台自己（运行时）用的，依赖 TypeScript 编译链。
//   控制台安装包里只有 node.exe，没有 tsx，所以这里用纯 .mjs 重写一份。
//   两份逻辑保持一致，改的时候要一起改。
import { execFileSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { cp, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const REPO = {
  owner: 'caizongfei41',
  name: 'manke-workbench',
  branch: 'main',
};

/** 会被替换的目录。少列一个不会出问题，多列一个可能删掉用户的东西。 */
const UPDATABLE = [
  'src',
  'scripts',
  'messages',
  'public',
  'launcher',
  'docs',
  'drizzle',
  'data/comfyui',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'drizzle.config.ts',
  'project.inlang',
  'version.json',
];

/** 不许被覆盖。 */
const PROTECTED = new Set(['data/comfyui.config.json', '.env', '.env.local']);

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const resolveRoot = () => {
  const explicit = valueOf('--root');
  if (explicit) return resolve(explicit);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
};

const readVersion = (root) => {
  try {
    // PowerShell 的 Set-Content -Encoding UTF8 会写 BOM，
    // JSON.parse 遇到 BOM 直接抛异常。stripBom 兜住这个坑。
    const raw = readFileSync(join(root, 'version.json'), 'utf8').replace(/^\uFEFF/, '');
    const j = JSON.parse(raw);
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
};

/** 7z：控制台自带的优先。 */
const findSevenZip = (root) => {
  const candidates = [
    join(root, 'node', '7z.exe'),
    join(root, '..', 'node', '7z.exe'),
    join(dirname(fileURLToPath(import.meta.url)), '..', 'node', '7z.exe'),
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
};

const say = (msg) => console.log(msg);

/** 递归复制，跳过保护清单。 */
const copyOver = async (from, to) => {
  let count = 0;
  const walk = async (src, dst) => {
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(dst, { recursive: true });
      for (const name of readdirSync(src)) {
        await walk(join(src, name), join(dst, name));
      }
      return;
    }
    const rel = relative(from, src).split('\\').join('/');
    if (PROTECTED.has(rel)) return;
    mkdirSync(dirname(dst), { recursive: true });
    await cp(src, dst);
    count += 1;
  };
  await walk(from, to);
  return count;
};

const run = (cmd, cmdArgs, cwd) => {
  try {
    say(`$ ${cmd} ${cmdArgs.join(' ')}`);
    const out = execFileSync(cmd, cmdArgs, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 900_000,
      shell: process.platform === 'win32',
    });
    const tail = String(out).trim().split('\n').slice(-3).join('\n');
    if (tail) say(tail);
    return true;
  } catch (error) {
    say(String(error.stdout ?? error).slice(0, 800));
    return false;
  }
};

const main = async () => {
  const root = resolveRoot();
  const ref = valueOf('--ref') ?? REPO.branch;
  const backup = join(root, '.update-backup');
  let work = null;
  let changed = [];
  const from = readVersion(root);

  say(`工作台：${root}`);
  say(`当前版本：${from ?? '（没有 version.json）'}`);
  say(`目标：${ref}`);
  say('');

  try {
    const sevenZip = findSevenZip(root);
    if (!sevenZip) {
      say('找不到 7z.exe，无法解压更新包');
      process.exit(1);
    }

    // 1. 下载
    work = await mkdtemp(join(tmpdir(), 'manke-update-'));
    const tgz = join(work, 'src.tar.gz');
    const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/tarball/${ref}`;
    say(`下载 ${url}`);

    const res = await fetch(url, {
      headers: { 'user-agent': 'manke-workbench-updater' },
      redirect: 'follow',
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok || !res.body) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tgz));
    say(`已下载 ${(statSync(tgz).size / 1024 ** 2).toFixed(1)} MB`);

    // 2. 解压（7z 分两步：gzip → tar）
    const unpack = join(work, 'unpacked');
    mkdirSync(unpack, { recursive: true });
    execFileSync(sevenZip, ['x', '-y', `-o${work}`, tgz], { stdio: 'pipe' });
    const tarFile = readdirSync(work).find((f) => f.endsWith('.tar'));
    if (!tarFile) throw new Error('gzip 解包后没有 .tar');
    execFileSync(sevenZip, ['x', '-y', `-o${unpack}`, join(work, tarFile)], { stdio: 'pipe' });
    const dirs = readdirSync(unpack, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (dirs.length !== 1) throw new Error(`压缩包结构异常（${dirs.length} 个根目录）`);
    const source = join(unpack, dirs[0].name);
    say('已解压');

    // 3. 备份
    rmSync(backup, { recursive: true, force: true });
    mkdirSync(backup, { recursive: true });
    for (const item of UPDATABLE) {
      const src = join(root, item);
      if (!existsSync(src)) continue;
      const dst = join(backup, item);
      mkdirSync(dirname(dst), { recursive: true });
      try {
        await rename(src, dst);
      } catch {
        await cp(src, dst, { recursive: true });
        rmSync(src, { recursive: true, force: true });
      }
      changed.push(item);
    }
    say(`已备份 ${changed.length} 项`);

    // 4. 覆盖
    let files = 0;
    for (const item of UPDATABLE) {
      const src = join(source, item);
      if (!existsSync(src)) continue;
      files += await copyOver(src, join(root, item));
    }
    say(`已覆盖 ${files} 个文件`);

    // 5. 依赖
    if (!existsSync(join(root, 'node_modules')) || existsSync(join(source, 'pnpm-lock.yaml'))) {
      say('检查依赖…');
      if (!run('pnpm', ['install'], root)) {
        say('pnpm install 失败，尝试继续构建（依赖可能已经够用）');
      }
    }

    // 6. 构建
    if (!run('pnpm', ['build'], root)) {
      throw new Error('构建失败');
    }

    rmSync(backup, { recursive: true, force: true });
    say('');
    say(`更新完成：${from ?? '?'} → ${readVersion(root) ?? '?'}`);
    say('要生效请重启工作台（控制台「全部停止」再「全部启动」）。');
    await rm(work, { recursive: true, force: true }).catch(() => {});
    process.exit(0);
  } catch (error) {
    say('');
    say(`更新失败：${error instanceof Error ? error.message : String(error)}`);

    // 回滚
    if (existsSync(backup) && changed.length > 0) {
      say('开始回滚…');
      for (const item of changed) {
        const src = join(backup, item);
        if (!existsSync(src)) continue;
        const dst = join(root, item);
        rmSync(dst, { recursive: true, force: true });
        try {
          await rename(src, dst);
        } catch {
          await cp(src, dst, { recursive: true });
          rmSync(src, { recursive: true, force: true });
        }
      }
      rmSync(backup, { recursive: true, force: true });
      say('已回滚到更新前，工作台仍可用。');
    }

    if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }
};

main();

// 工作台远程更新
//
// 给控制台和命令行共用。核心流程：
//   检查版本 → 下载 tarball → 解压覆盖 → 重建 → 失败回滚
//
// 为什么不走 git：
//   git 要求 .git 目录（17.6 MB）打进部署包，还要求目标机器装了 git。
//   GitHub 的 tarball 接口只依赖 HTTP，Node 自带 fetch。
//
// 为什么用 7z 解压而不是引入 tar 依赖：
//   控制台安装包里已经带了 7z.exe（解压部署分卷要用）。
//   7z 支持 gzip 和 tar，两步解即可。少一个 npm 依赖，少一份供应链风险，
//   而且 pnpm store 版本不一致时 add 会失败 —— 这个坑不值得踩。

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
import { cp, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** 仓库信息。换仓库只改这里。 */
export const REPO = {
  owner: 'caizongfei41',
  name: 'manke-workbench',
  branch: 'main',
};

/**
 * 更新时会被替换的目录和文件。
 *
 * 只覆盖代码 —— 用户的 data/（项目、素材、配置）、.output/、node_modules/
 * 一律不动。少列一个不会出问题，多列一个可能删掉用户的东西。
 */
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

/** 无论 tarball 里有什么，这些都不许覆盖。 */
const PROTECTED = new Set(['data/comfyui.config.json', '.env', '.env.local']);

export type UpdateCheck = {
  currentVersion: string | null;
  latestVersion: string | null;
  behind: boolean;
  latestCommit: string | null;
  latestMessage: string | null;
  publishedAt: string | null;
  error: string | null;
};

export type UpdateResult = {
  ok: boolean;
  from: string | null;
  to: string | null;
  files: number;
  installed: boolean;
  built: boolean;
  rolledBack: boolean;
  log: string[];
  error: string | null;
};

const readJsonFile = async (path: string): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** 本地版本号。version.json 由发布流程写入。 */
export const readLocalVersion = async (root: string): Promise<string | null> => {
  const v = await readJsonFile(join(root, 'version.json'));
  return typeof v?.version === 'string' ? v.version : null;
};

/** 找 7z：控制台安装包自带，或系统安装的。 */
const findSevenZip = (root: string): string | null => {
  const candidates = [
    join(root, 'node', '7z.exe'),
    join(root, '..', 'node', '7z.exe'),
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
};

/**
 * 查询远程最新版本。
 *
 * 用 GitHub REST API 而不是 git ls-remote：
 *   · 不需要 git
 *   · 能拿到 commit message 和时间，可以展示给用户
 *   · 公开仓库不需要 token，未认证限速 60 次/小时
 */
export const checkRemote = async (root: string): Promise<UpdateCheck> => {
  const currentVersion = await readLocalVersion(root);
  const base: UpdateCheck = {
    currentVersion,
    latestVersion: null,
    behind: false,
    latestCommit: null,
    latestMessage: null,
    publishedAt: null,
    error: null,
  };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO.owner}/${REPO.name}/commits/${REPO.branch}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'manke-workbench-updater',
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      return { ...base, error: `GitHub API 返回 ${res.status}` };
    }
    const data = (await res.json()) as {
      sha?: string;
      commit?: { message?: string; author?: { date?: string } };
    };
    const latestCommit = data.sha?.slice(0, 7) ?? null;
    const latestMessage = data.commit?.message?.split('\n')[0] ?? null;
    const publishedAt = data.commit?.author?.date ?? null;

    // 远程 version.json 优先；拿不到就用 commit hash 当版本
    let latestVersion: string | null = null;
    try {
      const vres = await fetch(
        `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/version.json`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (vres.ok) {
        const vj = (await vres.json()) as { version?: string };
        latestVersion = vj.version ?? null;
      }
    } catch {
      /* version.json 不存在时用 commit 兜底 */
    }
    if (!latestVersion) latestVersion = latestCommit;

    // 没有 version.json 的老部署一律视为需要更新
    const behind = !currentVersion || (latestVersion !== null && currentVersion !== latestVersion);

    return {
      currentVersion,
      latestVersion,
      behind,
      latestCommit,
      latestMessage,
      publishedAt,
      error: null,
    };
  } catch (cause) {
    return { ...base, error: cause instanceof Error ? cause.message : String(cause) };
  }
};

/** 下载 tarball 并用 7z 解压，返回解压出的根目录。 */
const fetchTarball = async (root: string, ref: string, log: string[]): Promise<string> => {
  const sevenZip = findSevenZip(root);
  if (!sevenZip) {
    throw new Error('找不到 7z.exe，无法解压更新包');
  }

  const work = await mkdtemp(join(tmpdir(), 'manke-update-'));
  const tgz = join(work, 'src.tar.gz');

  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/tarball/${ref}`;
  log.push(`下载 ${url}`);

  const res = await fetch(url, {
    headers: { 'user-agent': 'manke-workbench-updater' },
    signal: AbortSignal.timeout(180_000),
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败：HTTP ${res.status}`);
  }

  // fetch 返回的是 Web ReadableStream，pipeline 要 Node 的。
  // Node 18+ 提供 Readable.fromWeb 做转换，别手写 reader 循环。
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tgz));
  log.push(`已下载 ${(statSync(tgz).size / 1024 ** 2).toFixed(1)} MB`);

  // 7z 解 tap.gz 是两步：先 gzip 拆包，再 tar 提取
  const unpack = join(work, 'unpacked');
  mkdirSync(unpack, { recursive: true });
  execFileSync(sevenZip, ['x', '-y', `-o${work}`, tgz], { stdio: 'pipe' });
  const tarFile = readdirSync(work).find((f) => f.endsWith('.tar'));
  if (!tarFile) {
    throw new Error('gzip 解包后没找到 .tar 文件');
  }
  execFileSync(sevenZip, ['x', '-y', `-o${unpack}`, join(work, tarFile)], { stdio: 'pipe' });
  log.push('已解压');

  // 去掉 <owner>-<repo>-<sha>/ 前缀
  const dirs = readdirSync(unpack, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (dirs.length !== 1) {
    throw new Error(`压缩包结构异常：根目录有 ${dirs.length} 项`);
  }
  return join(unpack, dirs[0].name);
};

/** 递归复制，跳过保护清单。返回复制的文件数。 */
const copyOver = async (from: string, to: string): Promise<number> => {
  let count = 0;
  const walk = async (src: string, dst: string): Promise<void> => {
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

/** 跑命令，返回是否成功。 */
const run = (cmd: string, args: string[], cwd: string, log: string[]): boolean => {
  try {
    log.push(`$ ${cmd} ${args.join(' ')}`);
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
      env: { ...process.env },
    });
    const tail = String(out).trim().split('\n').slice(-3).join('\n');
    if (tail) log.push(tail);
    return true;
  } catch (error) {
    const msg = String((error as { stdout?: string; stderr?: string }).stdout ?? error);
    log.push(msg.slice(0, 800));
    return false;
  }
};

/**
 * 执行更新。
 *
 * 回滚策略：先把会被覆盖的目录整体挪到 .update-backup/，
 * 构建失败就挪回来。即使覆盖中途出错，用户也能回到可用状态。
 */
export const applyUpdate = async (root: string, ref?: string): Promise<UpdateResult> => {
  const log: string[] = [];
  const result: UpdateResult = {
    ok: false,
    from: null,
    to: null,
    files: 0,
    installed: false,
    built: false,
    rolledBack: false,
    log,
    error: null,
  };

  const backup = join(root, '.update-backup');
  let workDir: string | null = null;

  try {
    result.from = await readLocalVersion(root);

    // 1. 下载解压
    workDir = await fetchTarball(root, ref ?? REPO.branch, log);

    // 2. 备份
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
        // rename 跨盘会失败，退化到复制
        await cp(src, dst, { recursive: true });
        rmSync(src, { recursive: true, force: true });
      }
    }
    log.push('已备份原有代码');

    // 3. 覆盖
    for (const item of UPDATABLE) {
      const src = join(workDir, item);
      if (!existsSync(src)) continue;
      result.files += await copyOver(src, join(root, item));
    }
    log.push(`已覆盖 ${result.files} 个文件`);
    result.to = await readLocalVersion(root);

    // 4. 依赖：lockfile 变了或没装过才装
    const needInstall =
      !existsSync(join(root, 'node_modules')) || existsSync(join(workDir, 'pnpm-lock.yaml'));
    if (needInstall) {
      log.push('依赖可能有变化，执行 pnpm install');
      result.installed = run('pnpm', ['install'], root, log);
    }

    // 5. 构建
    result.built = run('pnpm', ['build'], root, log);
    if (!result.built) {
      throw new Error('构建失败');
    }

    rmSync(backup, { recursive: true, force: true });
    result.ok = true;
    log.push('更新完成');
  } catch (cause) {
    result.error = cause instanceof Error ? cause.message : String(cause);
    log.push(`更新失败：${result.error}`);

    try {
      if (existsSync(backup)) {
        log.push('开始回滚');
        for (const item of UPDATABLE) {
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
        result.rolledBack = true;
        log.push('已回滚到更新前的版本');
      }
    } catch (rollbackError) {
      log.push(`回滚失败：${String(rollbackError)}`);
    }
  } finally {
    if (workDir) {
      await rm(dirname(workDir), { recursive: true, force: true }).catch(() => {});
    }
  }

  return result;
};

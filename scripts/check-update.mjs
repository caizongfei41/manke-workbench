#!/usr/bin/env node
// 检查工作台更新
//
//   node scripts/check-update.mjs --root "C:\path\to\workbench"
//
// 只查询，不修改任何文件。控制台「检查更新」按钮调这个。
//
// 为什么不用 node --import tsx 直接跑 .ts：
//   控制台安装包里只有 node.exe，没有 tsx 之类的 loader。
//   这个脚本用纯 .mjs 实现，直接把逻辑写一遍，
//   避免为了跑一个 HTTP 请求而引入整套 TypeScript 运行时。
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO = {
  owner: 'caizongfei41',
  name: 'manke-workbench',
  branch: 'main',
};

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

/** 工作台根目录：--root 指定，或从脚本位置上推两级。 */
const resolveRoot = () => {
  const explicit = valueOf('--root');
  if (explicit) return resolve(explicit);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
};

const readLocalVersion = (root) => {
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

const main = async () => {
  // Windows 控制台默认 GBK，输出中文会乱码。切到 UTF-8。
  try {
    process.stdout.setDefaultEncoding?.('utf8');
  } catch {
    /* 忽略 */
  }

  const root = resolveRoot();
  const current = readLocalVersion(root);

  console.log(`工作台：${root}`);
  console.log(`本地版本：${current ?? '（没有 version.json）'}`);

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
      console.log(`无法连接 GitHub（HTTP ${res.status}）`);
      process.exit(1);
    }
    const data = await res.json();
    const commit = data.sha?.slice(0, 7) ?? '?';
    const message = (data.commit?.message ?? '').split('\n')[0];
    const date = data.commit?.author?.date?.slice(0, 10) ?? '?';

    let latest = null;
    try {
      const vres = await fetch(
        `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/version.json`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (vres.ok) {
        const vj = await vres.json();
        latest = vj.version ?? null;
      }
    } catch {
      /* 用 commit 兜底 */
    }
    if (!latest) latest = commit;

    console.log(`远程版本：${latest}`);
    console.log(`最新提交：${commit}  ${date}`);
    console.log(`提交说明：${message}`);
    console.log('');

    const behind = !current || current !== latest;
    if (behind) {
      console.log('状态：有新版本，可以点「更新工作台」');
      process.exit(0);
    }
    console.log('状态：已是最新版本');
    process.exit(0);
  } catch (error) {
    console.log(`检查失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

main();

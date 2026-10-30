// postinstall：准备 data 目录和数据库 schema 文件
//
// 取代原来的 shell 写法：
//   mkdir -p data && (test -f src/config/db/schema.ts || node scripts/db-setup.mjs)
//
// `mkdir -p` 和 `test -f` 是 Unix 命令。npm 在 Windows 上用 cmd.exe 执行
// postinstall，cmd 不认识 `-p`，会把它当成要创建的目录名，于是报
// 「子目录或文件 data 已经存在」并让整个 install 失败。
// 更糟的是失败发生在更新流程里，用户看到的是「更新失败」而不是这条提示。
//
// 改成 Node 脚本，行为与平台无关。
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const ensureDir = (relative) => {
  const target = join(ROOT, relative);
  if (existsSync(target)) return false;
  mkdirSync(target, { recursive: true });
  return true;
};

// data 目录：运行期配置、日志、生成结果都放这里
const created = [];
for (const dir of ['data', 'data/logs', 'data/generated']) {
  if (ensureDir(dir)) created.push(dir);
}
if (created.length) console.log(`  postinstall: 创建目录 ${created.join(', ')}`);

// schema.ts 是由 schema.sqlite.ts 派生的，缺了才生成
const schema = join(ROOT, 'src', 'config', 'db', 'schema.ts');
if (!existsSync(schema)) {
  console.log('  postinstall: 生成 src/config/db/schema.ts');
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'db-setup.mjs')], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error(`  postinstall: db-setup 失败 —— ${String(error).slice(0, 200)}`);
    // 不阻断安装：schema 缺失可以让 prebuild 再生成一次
  }
}

// 建表。
//
// data/local.db 可能不存在，也可能是 0 字节的空壳 —— 有文件没表时工作台
// 能启动、页面能打开，但每个项目操作都会失败：
//   Failed query: select "project"."id", "project"."name", ...
// 这个错在执行层才冒出来，看起来像代码 bug，实际是库没初始化。
//
// 不能只看主文件大小：SQLite 开着 WAL，建表后新数据可能在 local.db-wal 里，
// 主文件还是小。所以直接问库有没有 asset 表，最可靠。
const dbFile = join(ROOT, 'data', 'local.db');

const hasSchema = () => {
  if (!existsSync(dbFile)) return false;
  try {
    // node:sqlite 从 22.5 起随 Node 提供，控制台自带的 node 就是这一版
    const probe = new DatabaseSync(dbFile, { readOnly: true });
    const row = probe
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='asset'")
      .get();
    probe.close();
    return Boolean(row && row.c > 0);
  } catch {
    // 文件存在但读不了（损坏、被占用、或是旧格式）—— 当作没建，让 push 去修
    return false;
  }
};

if (!hasSchema()) {
  console.log('  postinstall: 初始化数据库表结构');
  try {
    // drizzle-kit 在 node_modules/.bin 下，Windows 上是 .cmd，不能直接
    // spawn，走 pnpm exec 最稳
    execFileSync(
      'pnpm',
      ['exec', 'drizzle-kit', 'push', '--config=drizzle.config.ts'],
      { cwd: ROOT, stdio: 'inherit', shell: true }
    );
  } catch (error) {
    console.error(`  postinstall: db push 失败 —— ${String(error).slice(0, 200)}`);
    console.error('  工作台仍能启动，但新建/打开项目会报错。手动修复：pnpm db:push');
  }
} else {
  console.log('  postinstall: 数据库表结构已就绪，跳过');
}

// 把随包分发的展示素材写进数据库。
//
// 首页轮播读的是 asset 表，不是 public/showcase/ 目录本身：它按文件名过滤
// SHOWCASE_WIDE_ORDER / SHOWCASE_CLIP_ORDER，还要求记录属于「首页展示」项目。
// 没有这些行，全新安装打开首页只有「还没有生成记录」，而文件就躺在磁盘上。
//
// 幂等：按项目内的文件名匹配，重复跑只多一次小查询。
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'seed-showcase.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch (error) {
  console.error(`  postinstall: 展示素材写入失败 —— ${String(error).slice(0, 200)}`);
  console.error('  首页会显示空状态。手动修复：node scripts/seed-showcase.mjs');
}

console.log('  postinstall: 完成');

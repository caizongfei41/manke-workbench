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
import { existsSync, mkdirSync } from 'node:fs';
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

console.log('  postinstall: 完成');

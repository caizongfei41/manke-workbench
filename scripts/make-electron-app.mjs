// 准备 Electron 的 app 目录。
//
// electron-builder 有个默认行为很坑：它把根 package.json 里的生产依赖整棵
// 打进 asar。我们的主进程一个依赖都不需要（只用 electron 和 node: 内置模块），
// 那份依赖树只会让包从 120 MB 涨到 300 MB 还把启动搞坏。
//
// 与其在 files 里写一长串排除（漏一个就前功尽弃），不如拿出一个干净的目录：
//
//   build-app/
//   ├── package.json     ← 专供运行时的 CJS 清单
//   ├── main.cjs
//   ├── preload.cjs
//   └── db-bootstrap.cjs
//
// 然后 directories.app 指过去。electron-builder 只会打包它看到的东西。
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = join(ROOT, 'build-app');
const SRC = join(ROOT, 'electron');

rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

const files = ['main.cjs', 'preload.cjs', 'db-bootstrap.cjs', 'bundle.cjs'];
for (const f of files) {
  const from = join(SRC, f);
  if (!existsSync(from)) {
    console.error(`  缺少 ${f}`);
    process.exit(1);
  }
  copyFileSync(from, join(APP, f));
}

// 运行时清单：CJS，无依赖，只声明入口
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
writeFileSync(
  join(APP, 'package.json'),
  JSON.stringify(
    {
      name: rootPkg.name,
      productName: '漫客工作台',
      version: rootPkg.version,
      description: rootPkg.description,
      main: 'main.cjs',
      author: '漫客工作台',
      license: 'SEE LICENSE IN LICENSE',
    },
    null,
    2
  ) + '\n'
);

console.log(`  build-app: ${files.length + 1} 个文件`);

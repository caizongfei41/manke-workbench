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

const files = ['main.cjs', 'preload.cjs', 'db-bootstrap.cjs', 'bundle.cjs', 'deploy-state.cjs', 'modules.cjs', 'updater.cjs'];
for (const f of files) {
  const from = join(SRC, f);
  if (!existsSync(from)) {
    console.error(`  缺少 ${f}`);
    process.exit(1);
  }
  copyFileSync(from, join(APP, f));
}

// 运行时清单：CJS 入口 + 真正需要在主进程 require 的依赖。
//
// 这个目录会被 electron-builder 当成 app 根，它只会装这里列出的 dependencies。
// 不列的话 electron-updater 就 require 不到 —— 打包不报错，运行时才炸，而且
// 只在「检查更新」那一步炸，平时完全看不出来。
const RUNTIME_DEPS = ['electron-updater'];

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const runtimeDeps = {};
for (const name of RUNTIME_DEPS) {
  const version = rootPkg.dependencies?.[name];
  if (version) runtimeDeps[name] = version;
  else console.log(`  ⚠ 缺少运行时依赖 ${name}`);
}

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
      dependencies: runtimeDeps,
    },
    null,
    2
  ) + '\n'
);

console.log(`  build-app: ${files.length + 1} 个文件，依赖 ${Object.keys(runtimeDeps).join(', ') || '无'}`);

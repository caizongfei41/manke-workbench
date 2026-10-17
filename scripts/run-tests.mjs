import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...globSync('src/**/*.test.ts', { cwd: root }),
  ...globSync('src/**/*.test.tsx', { cwd: root }),
]
  .sort()
  .map((file) => join(root, file));

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files],
  {
    cwd: root,
    stdio: 'inherit',
    // 测试套件按 BeatAPI 作为默认生成 provider 编写。
    // 产品可通过 BEATDESIGN_GENERATION_PROVIDER 切换（本项目默认 comfyui）。
    env: { ...process.env, BEATDESIGN_GENERATION_PROVIDER: 'beatapi' },
  }
);

process.exit(result.status ?? 1);

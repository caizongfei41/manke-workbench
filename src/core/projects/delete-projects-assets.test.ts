// 删除项目时的资产级联清理
//
//   node --test src/core/projects/delete-projects-assets.test.ts
//
// 这里验证的是「删掉项目之后，它的资产不会变成查不到文件的孤儿记录」。
// 之前 deleteProjects 只改 project.status，资产表和磁盘都不动，
// 一次清理攒出 1230 条指向空文件的记录，素材库点开全是 404。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createLocalProjectAssetObjectKey,
  getLocalProjectAssetRoot,
  trashLocalProjectAssets,
} from './local-project-assets';

const makeRoot = () => mkdtempSync(join(tmpdir(), 'beatapi-delete-assets-'));

/** 在资产根下铺一个项目的目录，写入若干文件。 */
const seedProject = (root: string, projectId: string, files: string[]) => {
  for (const name of files) {
    const objectKey = createLocalProjectAssetObjectKey({
      projectId,
      assetId: `asset-${name.replace(/\W/g, '')}`,
      filename: name,
    });
    const full = join(root, objectKey);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'x'.repeat(1024));
  }
};

test('项目目录整体移进回收站，源目录不再存在', async () => {
  const root = makeRoot();
  const trash = join(root, '__trash');
  seedProject(root, 'proj-a', ['a.png', 'b.mp4']);

  assert.equal(existsSync(join(root, 'proj-a')), true);

  const moved = await trashLocalProjectAssets({
    projectId: 'proj-a',
    assetRoot: root,
    trashRoot: trash,
  });

  assert.ok(moved, '应该返回移走后的路径');
  assert.equal(existsSync(join(root, 'proj-a')), false, '源目录应已移走');
  assert.equal(existsSync(moved), true, '回收站里应该有它的副本');
  assert.equal(readdirSync(moved).length, 2);
});

test('资产目录不存在时不报错，返回 null', async () => {
  const root = makeRoot();
  const moved = await trashLocalProjectAssets({
    projectId: 'never-existed',
    assetRoot: root,
    trashRoot: join(root, '__trash'),
  });
  assert.equal(moved, null);
});

test('重复删除同一项目不会覆盖上一次的回收站副本', async () => {
  const root = makeRoot();
  const trash = join(root, '__trash');

  seedProject(root, 'proj-b', ['first.png']);
  const first = await trashLocalProjectAssets({
    projectId: 'proj-b',
    assetRoot: root,
    trashRoot: trash,
  });

  // 同名项目再出现一次（比如导入备份后重建）
  seedProject(root, 'proj-b', ['second.png']);
  const second = await trashLocalProjectAssets({
    projectId: 'proj-b',
    assetRoot: root,
    trashRoot: trash,
  });

  assert.ok(first && second);
  assert.notEqual(first, second, '第二次应该换一个目录名，不能覆盖');
  assert.equal(existsSync(first), true, '第一次的备份还在');
  // 目录结构是 <projectId>/<assetId>/<filename>，所以看文件名要再下一层
  assert.equal(readdirSync(first)[0], 'asset-firstpng');
  assert.equal(readdirSync(join(first, 'asset-firstpng'))[0], 'first.png');
  assert.equal(existsSync(second), true);
});

test('非法项目 id 会被拒绝，不会把路径带出资产根', async () => {
  const root = makeRoot();
  for (const bad of ['../escape', 'a/b', '', '.', '..']) {
    await assert.rejects(
      () =>
        trashLocalProjectAssets({
          projectId: bad,
          assetRoot: root,
          trashRoot: join(root, '__trash'),
        }),
      `应拒绝 ${JSON.stringify(bad)}`
    );
  }
});

test('资产根默认落在 data/project-assets', () => {
  const root = getLocalProjectAssetRoot();
  assert.match(root.replace(/\\/g, '/'), /project-assets$/);
});

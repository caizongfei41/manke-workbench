import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildShotsFromScript, linkAssetsToShots, mergeAssets } from './drama-document';
import { analyzeScript } from './drama-document';

const SCRIPT = [
  '【人物】',
  '阿明：28 岁，黑色风衣',
  '小雅：24 岁，白色连衣裙',
  '',
  '【场景】',
  '天台：黄昏',
  '',
  '【第1段｜3秒】',
  '中景，天台，阿明独自站着。',
  '',
  '【第2段｜3秒】',
  '近景，阿明和小雅并肩。',
  '',
  '【第3段｜3秒】',
  '空镜，雨滴落下。',
].join('\n');

describe('buildShotsFromScript', () => {
  test('links each shot to the assets named in its own prompt', () => {
    const shots = buildShotsFromScript(SCRIPT);
    const { assets } = analyzeScript(SCRIPT);
    const idOf = (name: string) => assets.find((a) => a.name === name)?.id ?? '';

    assert.equal(shots.length, 3);
    // 第一段提到阿明和天台，两个都要挂上
    assert.equal(shots[0].publicAssetIds.length, 2);
    assert.ok(shots[0].publicAssetIds.includes(idOf('阿明')));
    assert.ok(shots[0].publicAssetIds.includes(idOf('天台')));
    // 第二段两个人都在
    assert.equal(shots[1].publicAssetIds.length, 2);
    assert.ok(shots[1].publicAssetIds.includes(idOf('小雅')));
    // 第三段没提任何人
    assert.deepEqual(shots[2].publicAssetIds, []);
  });
});

describe('linkAssetsToShots', () => {
  test('re-points ids onto a merged asset that already existed', () => {
    const shots = buildShotsFromScript(SCRIPT);
    const { assets } = analyzeScript(SCRIPT);
    // 模拟：阿明在合并前就已经存在，合并后保留了旧 id
    const existing = [{ ...assets[0], id: 'existing-aming' }];
    const merged = mergeAssets(existing, assets);
    const linked = linkAssetsToShots(shots, assets, merged);

    const mergedId = merged.find((a) => a.name === '阿明')?.id;
    assert.equal(mergedId, 'existing-aming');
    assert.ok(linked[0].publicAssetIds.includes(mergedId));
  });

  test('drops ids that no longer exist', () => {
    const shots = buildShotsFromScript(SCRIPT);
    const { assets } = analyzeScript(SCRIPT);
    const linked = linkAssetsToShots(shots, assets, []);
    assert.deepEqual(linked[0].publicAssetIds, []);
  });
});

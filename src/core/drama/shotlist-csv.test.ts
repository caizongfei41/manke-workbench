import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DramaDocument } from './drama-document';
import { buildShotListCsv, toCsv } from './shotlist-csv';

const drama = (overrides: Partial<DramaDocument> = {}): DramaDocument =>
  ({
    version: 1,
    script: '',
    positions: {},
    links: [],
    params: {},
    loras: [],
    subtitles: true,
    exportPreset: 'vertical',
    enhance: { enabled: false, rules: [], extra: '' },
    bgmAssetId: null,
    bgmName: null,
    bgmVolume: 0.25,
    publicAssets: [{ id: 'character-1', kind: 'character', name: '阿明', description: '', imageUrl: null }],
    shots: [],
    finalVideoUrl: null,
    finalStatus: 'idle',
    ...overrides,
  }) as DramaDocument;

describe('toCsv', () => {
  test('quotes every cell so commas and quotes survive', () => {
    const csv = toCsv([['a,b', 'say "hi"', 'plain']]);
    assert.equal(csv, '"a,b","say ""hi""","plain"');
  });

  test('keeps newlines inside a cell', () => {
    const csv = toCsv([['line1\nline2']]);
    assert.ok(csv.startsWith('"line1\nline2"'));
  });
});

describe('buildShotListCsv', () => {
  test('starts with a BOM so Excel reads Chinese correctly', () => {
    const csv = buildShotListCsv(drama());
    assert.equal(csv.charCodeAt(0), 0xfeff);
  });

  test('writes one row per shot plus a total', () => {
    const csv = buildShotListCsv(
      drama({
        shots: [
          {
            id: 's1',
            prompt: '中景。阿明：<d>[Chinese] 灯还亮着。</d>',
            seconds: 3,
            publicAssetIds: ['character-1'],
            ownImageUrls: [],
            videoUrl: '/v/1.mp4',
            status: 'succeeded',
          },
          {
            id: 's2',
            prompt: '近景。',
            seconds: 4,
            publicAssetIds: [],
            ownImageUrls: [],
            videoUrl: null,
            status: 'idle',
          },
        ],
        finalVideoUrl: '/final.mp4',
      })
    );

    const lines = csv.split('\r\n');
    assert.equal(lines[0].replace(/^\uFEFF/, ''), '"段号","秒数","状态","提示词","台词","角色 / 场景 / 道具","参考图","视频地址"');
    assert.equal(lines.length, 6); // header + 2 shots + blank + total + final
    assert.ok(csv.includes('"阿明"'), '角色名应出现在行里');
    assert.ok(csv.includes('"灯还亮着。"'), '台词应被单独抽出');
    assert.ok(!csv.includes('<d>'), '标记不应出现在导出里');
    assert.ok(csv.includes('"7"'), '合计应为 3+4');
    assert.ok(csv.includes('"/final.mp4"'));
  });

  test('a board with no shots still produces a valid file', () => {
    const csv = buildShotListCsv(drama());
    assert.ok(csv.includes('"合计"'));
    assert.equal(csv.split('\r\n').length, 4);
  });
});

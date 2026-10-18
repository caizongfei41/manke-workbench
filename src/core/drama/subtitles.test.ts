import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EXPORT_PRESETS,
  buildAssSubtitle,
  buildSubtitleCues,
  extractDialogue,
  presetPlayRes,
  stripDialogueMarkup,
} from './subtitles';

describe('extractDialogue', () => {
  test('takes the spoken line and drops the language tag', () => {
    assert.deepEqual(extractDialogue('画面描述 <d>[Chinese] 你来了。</d> 收尾'), ['你来了。']);
  });

  test('returns every line in order', () => {
    assert.deepEqual(extractDialogue('<d>甲</d> 中间 <d>乙</d>'), ['甲', '乙']);
  });

  test('ignores a shot without dialogue', () => {
    assert.deepEqual(extractDialogue('中景，他走过街头。'), []);
  });
});

describe('buildSubtitleCues', () => {
  test('walks the shots with cumulative timing', () => {
    const cues = buildSubtitleCues([
      { prompt: '<d>第一句</d>', seconds: 3 },
      { prompt: '没有台词', seconds: 4 },
      { prompt: '<d>第二句</d>', seconds: 5 },
    ]);
    assert.deepEqual(
      cues.map((cue) => cue.text),
      ['第一句', '第二句']
    );
    assert.equal(cues[0].start, 0);
    // 第二段没有台词，但时间照走：3 + 4
    assert.equal(cues[1].start, 7);
    assert.ok(cues[1].end < 12);
  });

  test('splits one shot between several lines', () => {
    const cues = buildSubtitleCues([{ prompt: '<d>甲</d> <d>乙</d>', seconds: 6 }]);
    assert.equal(cues.length, 2);
    assert.equal(cues[0].start, 0);
    assert.equal(cues[1].start, 3);
  });

  test('falls back to three seconds when a duration is missing', () => {
    const cues = buildSubtitleCues([
      { prompt: '<d>甲</d>', seconds: 0 },
      { prompt: '<d>乙</d>', seconds: 3 },
    ]);
    assert.equal(cues[1].start, 3);
  });

  test('wraps a long line instead of overflowing', () => {
    const long = '这是一个非常非常长的台词需要换行显示否则会超出画面宽度';
    const cues = buildSubtitleCues([{ prompt: `<d>${long}</d>`, seconds: 3 }]);
    assert.ok(cues[0].text.includes('\\N'));
  });
});

describe('buildAssSubtitle', () => {
  test('emits a valid script header and one event per cue', () => {
    const ass = buildAssSubtitle([
      { start: 0, end: 2.5, text: '你好' },
      { start: 2.5, end: 5, text: '再见' },
    ]);
    assert.ok(ass.includes('[Script Info]'));
    assert.ok(ass.includes('Style: Default'));
    assert.equal((ass.match(/^Dialogue: /gm) ?? []).length, 2);
    assert.ok(ass.includes('0:00:00.00,0:00:02.50'));
    assert.ok(ass.includes('0:00:02.50,0:00:05.00'));
  });

  test('accepts a custom font size', () => {
    const ass = buildAssSubtitle([{ start: 0, end: 1, text: 'a' }], { fontPx: 60 });
    assert.ok(ass.includes(',Microsoft YaHei,60,'));
  });
});

describe('export presets', () => {
  test('leaves the frame alone for source', () => {
    assert.equal(EXPORT_PRESETS.source.mode, 'none');
    assert.deepEqual(presetPlayRes('source'), { playResX: 1280, playResY: 720 });
  });

  test('vertical is the 1080x1920 short-drama target', () => {
    assert.equal(EXPORT_PRESETS.vertical.width, 1080);
    assert.equal(EXPORT_PRESETS.vertical.height, 1920);
    assert.deepEqual(presetPlayRes('vertical'), { playResX: 1080, playResY: 1920 });
  });

  test('falls back to source for an unknown id', () => {
    assert.deepEqual(presetPlayRes('nonsense'), { playResX: 1280, playResY: 720 });
  });

  test('writes the requested PlayRes into the ASS header', () => {
    const ass = buildAssSubtitle([{ start: 0, end: 1, text: 'a' }], presetPlayRes('vertical'));
    assert.ok(ass.includes('PlayResX: 1080'));
    assert.ok(ass.includes('PlayResY: 1920'));
  });
});

describe('stripDialogueMarkup', () => {
  test('removes the dialogue tags but keeps the line', () => {
    const prompt = '阿明站在路灯下。阿明：<d>[Chinese] 灯还亮着。</d>';
    const out = stripDialogueMarkup(prompt);
    assert.equal(out, '阿明站在路灯下。阿明：灯还亮着。');
    assert.ok(!out.includes('<d>') && !out.includes('[Chinese]'));
  });

  test('handles several lines and stray closing tags', () => {
    const out = stripDialogueMarkup('<d>一句话。</d>中间。<d>[English] Second.</d></d>');
    assert.equal(out, '一句话。中间。Second.');
  });

  test('leaves a prompt without markup alone', () => {
    assert.equal(stripDialogueMarkup('中景，雨夜街头。'), '中景，雨夜街头。');
  });
});
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseScriptDocument } from './script-document';

/**
 * A natively written Chinese screenplay has to yield its cast. The parser used to
 * only recognise the English "Name (S1) says:" speaker form, so scripts written the
 * way a Chinese short-drama writer writes them produced no characters at all.
 */
const characters = (script: string) =>
  parseScriptDocument(script)
    .assets.filter((asset) => asset.kind === 'character')
    .map((asset) => asset.name);

describe('parseScriptDocument — Chinese cast', () => {
  test('picks up a speaker line', () => {
    const names = characters('阿明：（低声）这条路我走过很多次。');
    assert.ok(names.includes('阿明'), `got ${JSON.stringify(names)}`);
  });

  test('picks up a subject line', () => {
    const names = characters('阿明站在路灯下，雨水顺着伞骨流下来。');
    assert.ok(names.includes('阿明'), `got ${JSON.stringify(names)}`);
  });

  test('collects the whole cast of a short script', () => {
    const script = [
      '场景：雨夜街头。',
      '',
      '阿明站在路灯下，雨水顺着伞骨流下来。',
      '阿明：（低声）这条路我走过很多次。',
      '',
      '小雅推开门，探头看过来。',
      '小雅：你还在等谁？',
    ].join('\n');
    const names = characters(script);
    assert.ok(names.includes('阿明'), `got ${JSON.stringify(names)}`);
    assert.ok(names.includes('小雅'), `got ${JSON.stringify(names)}`);
  });

  test('does not mistake camera and scene words for people', () => {
    const names = characters('镜头推近。\n画面转暗。\n中景：街头。');
    assert.deepEqual(names, [], `got ${JSON.stringify(names)}`);
  });

  test('keeps the English speaker form working', () => {
    const names = characters('Alice (S1) says: hello.');
    assert.ok(names.includes('Alice'), `got ${JSON.stringify(names)}`);
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ENHANCE_RULES,
  activeRuleTexts,
  createEmptyEnhancement,
  enhancePrompt,
} from './prompt-enhance';

describe('enhancePrompt', () => {
  test('leaves the prompt untouched when disabled', () => {
    const off = { ...createEmptyEnhancement(), rules: ['soloSubject' as const] };
    assert.equal(enhancePrompt('中景，他走过。', off), '中景，他走过。');
  });

  test('appends the selected rule', () => {
    const on = { enabled: true, rules: ['soloSubject' as const], extra: '' };
    assert.equal(
      enhancePrompt('中景，他走过', on),
      '中景，他走过。画面中只有他一人，街道空无一人，不要出现路人。'
    );
  });

  test('does not double the sentence stop', () => {
    const on = { enabled: true, rules: ['lockCamera' as const], extra: '' };
    const result = enhancePrompt('他停下脚步。', on);
    assert.ok(!result.startsWith('他停下脚步。。'));
    assert.ok(result.startsWith('他停下脚步。机位'));
  });

  test('keeps a stable rule order regardless of toggle order', () => {
    const a = { enabled: true, rules: ['noText' as const, 'soloSubject' as const], extra: '' };
    const b = { enabled: true, rules: ['soloSubject' as const, 'noText' as const], extra: '' };
    assert.equal(enhancePrompt('x', a), enhancePrompt('x', b));
    // 顺序按 ENHANCE_RULES 定义，而不是点击顺序
    assert.ok(enhancePrompt('x', a).indexOf('画面中只有他一人') < enhancePrompt('x', a).indexOf('不要出现任何文字'));
  });

  test('appends the free text last', () => {
    const on = { enabled: true, rules: ['soloSubject' as const], extra: '雨天，地面积水' };
    const result = enhancePrompt('中景', on);
    assert.ok(result.endsWith('雨天，地面积水。'));
  });

  test('works when the original prompt is empty', () => {
    const on = { enabled: true, rules: ['soloSubject' as const], extra: '' };
    assert.equal(
      enhancePrompt('', on),
      '画面中只有他一人，街道空无一人，不要出现路人。'
    );
  });

  test('every rule has non-empty text', () => {
    for (const rule of ENHANCE_RULES) {
      assert.ok(rule.text.trim().length > 0, rule.id);
    }
  });

  test('activeRuleTexts is empty when nothing is selected', () => {
    assert.deepEqual(activeRuleTexts({ enabled: true, rules: [], extra: '  ' }), []);
  });
});

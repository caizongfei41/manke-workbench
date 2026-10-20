import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyGenerationFailure } from './generation-failure';

test('显存不足被认出来', () => {
  const f = classifyGenerationFailure('torch.OutOfMemoryError: CUDA out of memory.');
  assert.equal(f.code, 'out-of-memory');
  assert.match(f.hint, /分辨率|显卡/);
});

test('缺模型被认出来', () => {
  const f = classifyGenerationFailure('Value not in list: ckpt_name not in []');
  assert.equal(f.code, 'model-missing');
});

test('队列满被认出来', () => {
  assert.equal(classifyGenerationFailure('QueueFull: too many prompts').code, 'queue-busy');
});

test('网络错误被认出来', () => {
  assert.equal(classifyGenerationFailure('TypeError: fetch failed').code, 'connection');
});

test('认不出的错误也保留原文', () => {
  const f = classifyGenerationFailure('ComfyUI task failed.');
  assert.equal(f.code, 'unknown');
  assert.equal(f.raw, 'ComfyUI task failed.');
  assert.ok(f.hint.length > 0);
});

test('空错误不会崩', () => {
  const f = classifyGenerationFailure(null);
  assert.equal(f.code, 'unknown');
  assert.equal(f.raw, 'ComfyUI task failed.');
});

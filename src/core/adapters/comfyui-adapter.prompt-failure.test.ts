// describePromptFailure 的单元测试
//
// 背景：之前 ComfyUI 拒绝工作流时只报 "failed (400)"，把 node_errors 全丢了。
// 用户看到 400 完全不知道为什么 —— 实际原因往往是某个模型文件没装。
import assert from 'node:assert/strict';
import test from 'node:test';

import { describePromptFailure } from './comfyui-adapter';

test('把 node_errors 里的 details 提取出来', () => {
  // 这是 sheetsage2 缺模型时的真实响应
  const body = JSON.stringify({
    error: {
      type: 'prompt_outputs_failed_validation',
      message: 'Prompt outputs failed validation',
    },
    node_errors: {
      '69': {
        class_type: 'AudioEncoderLoader',
        errors: [
          {
            type: 'value_not_in_list',
            details: "audio_encoder_name: 'sheetsage2_bf16.safetensors' not in []",
          },
        ],
      },
    },
  });

  const out = describePromptFailure(400, body);
  assert.match(out, /HTTP 400/);
  assert.match(out, /AudioEncoderLoader/);
  assert.match(out, /sheetsage2_bf16\.safetensors/);
});

test('多个节点出错时最多列三个', () => {
  const body = JSON.stringify({
    node_errors: {
      '1': { class_type: 'A', errors: [{ details: 'a 有问题' }] },
      '2': { class_type: 'B', errors: [{ details: 'b 有问题' }] },
      '3': { class_type: 'C', errors: [{ details: 'c 有问题' }] },
      '4': { class_type: 'D', errors: [{ details: 'd 有问题' }] },
    },
  });

  const out = describePromptFailure(400, body);
  assert.match(out, /A/);
  assert.match(out, /C/);
  assert.doesNotMatch(out, /D/);
});

test('没有 node_errors 时回退到 error.message', () => {
  const body = JSON.stringify({
    error: { type: 'invalid_prompt', message: 'Prompt is not a dict' },
  });
  assert.match(describePromptFailure(400, body), /Prompt is not a dict/);
});

test('响应不是 JSON 时截取原始内容', () => {
  assert.match(describePromptFailure(500, 'Internal Server Error'), /Internal Server Error/);
});

test('空响应只给状态码', () => {
  assert.equal(describePromptFailure(502, ''), 'ComfyUI 拒绝了这个工作流 (HTTP 502)');
});

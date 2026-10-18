import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  classifyGenerationFailure,
  isRetryableFailure,
  parseComfyMonitor,
} from './comfy-monitor';

describe('parseComfyMonitor', () => {
  test('reads queue depth and VRAM from the raw payloads', () => {
    const monitor = parseComfyMonitor({
      queue: { queue_running: [{}], queue_pending: [{}, {}] },
      stats: {
        system: { ram_total: 64 * 1024 ** 3, ram_free: 44 * 1024 ** 3, comfyui_version: '0.37.0' },
        devices: [{ vram_total: 20 * 1024 ** 3, vram_free: 8 * 1024 ** 3, name: 'cuda:0 RTX 3080' }],
      },
    });
    assert.equal(monitor.reachable, true);
    assert.equal(monitor.running, 1);
    assert.equal(monitor.pending, 2);
    assert.equal(monitor.vramTotalGb, 20);
    assert.equal(monitor.vramUsedGb, 12);
    assert.equal(monitor.ramUsedGb, 20);
    assert.equal(monitor.version, '0.37.0');
  });

  test('reports unreachable when nothing came back', () => {
    const monitor = parseComfyMonitor({});
    assert.equal(monitor.reachable, false);
    assert.equal(monitor.vramUsedGb, null);
    assert.equal(monitor.running, 0);
  });

  test('survives a half-broken payload', () => {
    const monitor = parseComfyMonitor({ queue: { queue_running: 'nope' }, stats: { devices: [] } });
    assert.equal(monitor.running, 0);
    assert.equal(monitor.vramTotalGb, null);
  });
});

describe('classifyGenerationFailure', () => {
  test('recognises a card running out of memory', () => {
    assert.equal(
      classifyGenerationFailure('RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB'),
      'outOfMemory'
    );
    assert.equal(classifyGenerationFailure('显存不足，无法分配'), 'outOfMemory');
  });

  test('recognises a missing custom node', () => {
    assert.equal(
      classifyGenerationFailure('Cannot execute because node AICG3D_H3Loader does not exist.'),
      'missingNode'
    );
  });

  test('recognises a missing model file', () => {
    assert.equal(
      classifyGenerationFailure('no such file: models/checkpoints/foo.safetensors'),
      'missingModel'
    );
  });

  test('recognises timeouts and cancellations', () => {
    assert.equal(classifyGenerationFailure('request timed out after 300s'), 'timeout');
    assert.equal(classifyGenerationFailure('execution interrupted by user'), 'cancelled');
  });

  test('recognises the provider being gone', () => {
    assert.equal(classifyGenerationFailure('TypeError: fetch failed'), 'serverDown');
    assert.equal(classifyGenerationFailure('connect ECONNREFUSED 127.0.0.1:8188'), 'serverDown');
  });

  test('falls back to unknown rather than guessing', () => {
    assert.equal(classifyGenerationFailure('something odd happened'), 'unknown');
    assert.equal(classifyGenerationFailure(null), 'unknown');
    assert.equal(classifyGenerationFailure(''), 'unknown');
  });

  test('only some failures are worth retrying as-is', () => {
    assert.equal(isRetryableFailure('outOfMemory'), true);
    assert.equal(isRetryableFailure('timeout'), true);
    assert.equal(isRetryableFailure('missingNode'), false);
    assert.equal(isRetryableFailure('missingModel'), false);
    assert.equal(isRetryableFailure('invalidInput'), false);
    assert.equal(isRetryableFailure('serverDown'), false);
  });
});

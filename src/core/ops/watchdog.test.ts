import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ALERT_AFTER_FAILURES,
  REMIND_EVERY,
  buildAlertMessage,
  parseFailingSuites,
  shouldAlert,
  trailingFailureStreak,
  type WatchdogRun,
} from './watchdog';

const run = (status: WatchdogRun['status'], extra: Partial<WatchdogRun> = {}): WatchdogRun => ({
  startedAt: '2026-10-19T10:00:00.000Z',
  status,
  ...extra,
});

describe('trailingFailureStreak', () => {
  test('counts the failures at the end', () => {
    assert.equal(trailingFailureStreak([run('passed'), run('failed'), run('failed')]), 2);
  });

  test('a pass resets it', () => {
    assert.equal(trailingFailureStreak([run('failed'), run('failed'), run('passed')]), 0);
  });

  test('skips neither count nor reset', () => {
    assert.equal(trailingFailureStreak([run('failed'), run('skipped'), run('failed')]), 2);
    assert.equal(trailingFailureStreak([run('skipped'), run('skipped')]), 0);
  });
});

describe('shouldAlert', () => {
  test('stays quiet on the first failure', () => {
    assert.equal(shouldAlert([run('failed')]), false);
  });

  test('speaks up when the streak reaches the threshold', () => {
    const history = Array.from({ length: ALERT_AFTER_FAILURES }, () => run('failed'));
    assert.equal(shouldAlert(history), true);
  });

  test('does not nag every round after that', () => {
    const history = Array.from({ length: ALERT_AFTER_FAILURES + 1 }, () => run('failed'));
    assert.equal(shouldAlert(history), false);
  });

  test('reminds again on the interval', () => {
    const history = Array.from({ length: REMIND_EVERY }, () => run('failed'));
    assert.equal(shouldAlert(history), true);
  });

  test('a pass silences it', () => {
    assert.equal(shouldAlert([run('failed'), run('failed'), run('passed')]), false);
  });
});

describe('parseFailingSuites', () => {
  test('picks the suite names out of the runner output', () => {
    const output = [
      '  ok    verify-ui                    通过  25 / 失败 0',
      '  FAIL  verify-drama-drag            通过   5 / 失败 4',
      '  FAIL  verify-monitor               通过  11 / 失败 5',
    ].join('\n');
    assert.deepEqual(parseFailingSuites(output), ['verify-drama-drag', 'verify-monitor']);
  });

  test('says nothing when nothing failed', () => {
    assert.deepEqual(parseFailingSuites('  ok    verify-ui  通过 25 / 失败 0'), []);
  });
});

describe('buildAlertMessage', () => {
  test('names the streak, the suites and the counts', () => {
    const message = buildAlertMessage({
      run: run('failed', { pass: 120, fail: 22, failing: ['verify-monitor'] }),
      streak: 2,
    });
    assert.ok(message.includes('连续 2 轮'));
    assert.ok(message.includes('verify-monitor'));
    assert.ok(message.includes('通过 120 / 失败 22'));
  });

  test('says so when the failing suites could not be parsed', () => {
    const message = buildAlertMessage({ run: run('failed'), streak: 2 });
    assert.ok(message.includes('未解析到具体套件'));
  });
});

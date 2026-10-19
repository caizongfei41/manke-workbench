/**
 * Failure alerting for the local suite watchdog.
 *
 * A watchdog that fails quietly is worse than none: the whole point is that nobody is
 * watching. But alerting on every red round is noise when a single flaky suite is
 * normal — so the rule is "two in a row", then a reminder every so often.
 */

export type WatchdogStatus = 'passed' | 'failed' | 'skipped';

export type WatchdogRun = {
  startedAt: string;
  finishedAt?: string;
  status: WatchdogStatus;
  pass?: number;
  fail?: number;
  failing?: string[];
};

/** How many consecutive failed rounds before the first alert. */
export const ALERT_AFTER_FAILURES = 2;

/** After the first alert, remind once every this many further failures. */
export const REMIND_EVERY = 6;

/** Rounds that actually ran; a skip says nothing about the code. */
export const ranRounds = (history: WatchdogRun[]) => history.filter((run) => run.status !== 'skipped');

/**
 * Length of the failing streak at the end of the history.
 *
 * Skips are ignored rather than counted either way: a missing ComfyUI is not evidence
 * that the suites are broken, and it should not reset the streak either.
 */
export const trailingFailureStreak = (history: WatchdogRun[]) => {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const status = history[i]?.status;
    if (status === 'skipped') continue;
    if (status === 'failed') streak += 1;
    else break;
  }
  return streak;
};

/**
 * Whether this round should raise its voice.
 *
 * True exactly when the streak reaches the threshold, then on multiples of the reminder
 * interval — so a persistent breakage nags without flooding.
 */
export const shouldAlert = (history: WatchdogRun[]) => {
  const streak = trailingFailureStreak(history);
  if (streak < ALERT_AFTER_FAILURES) return false;
  if (streak === ALERT_AFTER_FAILURES) return true;
  return streak % REMIND_EVERY === 0;
};

/** Suite names the runner printed as failed, e.g. `  FAIL  verify-drama-drag  3 / 4`. */
export const parseFailingSuites = (output: string) => {
  const names = new Set<string>();
  for (const match of output.matchAll(/^\s*FAIL\s+([a-z0-9-]+)/gim)) names.add(match[1]);
  return [...names];
};

export const buildAlertMessage = ({ run, streak }: { run: WatchdogRun; streak: number }) => {
  const failing = run.failing?.length ? run.failing.join(', ') : '（未解析到具体套件）';
  return [
    `连续 ${streak} 轮 GPU 套件失败`,
    `失败套件：${failing}`,
    `通过 ${run.pass ?? 0} / 失败 ${run.fail ?? 0}`,
    `时间：${run.startedAt}`,
  ].join('\n');
};

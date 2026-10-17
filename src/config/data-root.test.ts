import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  getBeatDesignDatabaseUrl,
  getBeatDesignDataRoot,
} from './data-root';

// getBeatDesignDataRoot resolves its input, so the expectation has to be an
// absolute path too. Compare with normalized separators so the assertion holds
// on Windows as well as POSIX.
const asPosix = (value: string) => value.replace(/\\/g, '/');
const REPO = resolve('tmp', 'beatdesign-repository');
const USER_DATA = resolve('tmp', 'beatdesign-user-data');

test('uses the repository data directory by default', () => {
  const root = getBeatDesignDataRoot(REPO, undefined);
  assert.equal(asPosix(root), asPosix(join(REPO, 'data')));
  assert.equal(
    getBeatDesignDatabaseUrl(REPO, undefined),
    'file:data/local.db'
  );
});

test('uses an explicit application-data directory for packaged runtimes', () => {
  const root = getBeatDesignDataRoot(resolve('tmp', 'ignored'), USER_DATA);
  assert.equal(asPosix(root), asPosix(USER_DATA));
  assert.equal(
    asPosix(getBeatDesignDatabaseUrl(resolve('tmp', 'ignored'), USER_DATA)),
    `file:${asPosix(join(USER_DATA, 'local.db'))}`
  );
});
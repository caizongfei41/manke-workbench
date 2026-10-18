import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { REPOSITORY_URL } from './repository';

test('the header link is a real https URL', () => {
  assert.match(REPOSITORY_URL, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
});

test('the header link matches the repository this build declares', () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8')
  ) as { homepage?: string; repository?: { url?: string } };

  const declared = (pkg.homepage ?? pkg.repository?.url ?? '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');

  // 一个 fork 曾经还指着上游仓库，这条断言就是为了不再漂
  assert.equal(REPOSITORY_URL, declared);
});

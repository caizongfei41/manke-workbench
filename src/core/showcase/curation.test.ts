import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SHOWCASE_PROJECT_NAME, isCurated, orderShowcase } from './curation';

const asset = (id: string, projectName: string | null) => ({ id, projectName });

describe('orderShowcase', () => {
  test('puts the curated project first', () => {
    const ordered = orderShowcase([
      asset('a', '测试'),
      asset('b', SHOWCASE_PROJECT_NAME),
      asset('c', null),
      asset('d', SHOWCASE_PROJECT_NAME),
    ]);
    assert.deepEqual(
      ordered.map((item) => item.id),
      ['b', 'd', 'a', 'c']
    );
  });

  test('keeps the incoming order inside each group', () => {
    const ordered = orderShowcase([
      asset('newest', 'other'),
      asset('curated-1', SHOWCASE_PROJECT_NAME),
      asset('older', 'other'),
      asset('curated-2', SHOWCASE_PROJECT_NAME),
    ]);
    assert.deepEqual(
      ordered.map((item) => item.id),
      ['curated-1', 'curated-2', 'newest', 'older']
    );
  });

  test('an empty library stays empty', () => {
    assert.deepEqual(orderShowcase([]), []);
  });
});

describe('isCurated', () => {
  test('matches by project name only', () => {
    assert.equal(isCurated({ id: 'x', projectName: SHOWCASE_PROJECT_NAME }), true);
    assert.equal(isCurated({ id: 'x', projectName: '首页展示 2' }), false);
    assert.equal(isCurated({ id: 'x', projectName: null }), false);
  });
});

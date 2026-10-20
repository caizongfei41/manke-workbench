import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./workspace-page.tsx', import.meta.url),
  'utf8'
);

/**
 * This page arrived from upstream with a guard: no search box, keep it simple.
 *
 * The premise was a handful of projects. With two dozen in the list, finding the film
 * you were working on last week became an eye scan, so the guard is retired — but only
 * the part that stopped being true. What still holds: a project resumes in the workspace
 * it was last used in, and the page never grows an "all projects" side door.
 */
test('projects page resumes each project in its last workspace and filters in place', () => {
  assert.match(source, /mode: project\.lastWorkspaceMode/);
  assert.doesNotMatch(source, /copy\.allProjects/);

  // The toolbar exists, and only once there is something to filter.
  assert.match(source, /data-project-search/);
  assert.match(source, /data-project-filter/);
  assert.match(source, /data-project-sort/);
  assert.match(source, /liveProjects\.length > 0 \? \(\s*<div className="[^"]*"\s+data-project-toolbar="true"/);

  // Filtering happens over the loaded list: no extra fetch, no server round trip.
  assert.match(source, /visibleProjects = useMemo/);

  assert.match(source, /copy\.createTitle/);
  // Four ways in, and one explicit way out.
  assert.match(source, /href: '\/studio'/);
  assert.match(source, /href: '\/canvas'/);
  assert.match(source, /href: '\/standard'/);
  assert.match(source, /href: '\/canvas\?kind=drama'/);
  assert.match(source, /data-create-close/);
});

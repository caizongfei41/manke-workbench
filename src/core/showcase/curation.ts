/**
 * Choosing what the front page shows.
 *
 * The library is whatever the machine happened to render, including test output that a
 * visitor should never see first. A curated set lives in one project, and the page prefers
 * it: newest work from that project, then everything else.
 */

/**
 * The project that holds the curated set. Kept in core because the name is content — the
 * component layer is not allowed to carry literal Chinese.
 */
export const SHOWCASE_PROJECT_NAME = '首页展示';

export type ShowcaseCandidate = {
  id: string;
  projectName?: string | null;
};

/**
 * Order candidates so the curated project comes first, then the rest.
 *
 * Stable: within each group the incoming order is preserved, which means "newest first"
 * stays true because the API already sorts by creation time.
 */
export const orderShowcase = <T extends ShowcaseCandidate>(items: T[]) => {
  const curated: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (item.projectName === SHOWCASE_PROJECT_NAME) curated.push(item);
    else rest.push(item);
  }
  return [...curated, ...rest];
};

/** True when the candidate belongs to the curated set. */
export const isCurated = (item: ShowcaseCandidate) => item.projectName === SHOWCASE_PROJECT_NAME;

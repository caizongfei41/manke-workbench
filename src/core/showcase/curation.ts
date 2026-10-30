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

/**
 * The wide frames the front page rotates, in the order they should appear.
 *
 * These ship with the app under public/showcase/ and are seeded into the curated
 * project on first run, so a fresh install has something to show before the machine
 * has rendered anything of its own. Naming beats counting: the project also holds
 * whatever the user generates later, and the rotation asks for these by name.
 */
export const SHOWCASE_WIDE_ORDER = [
  'abstract-liquid.png',
  'architecture.png',
  'cinematic-portrait.png',
  'film-nostalgia.png',
  'ink-landscape.png',
  'macro-nature.png',
  'neon-street.png',
  'product-still.png',
] as const;

/** -1 for anything that is not part of the rotation. */
export const showcaseOrderOf = (filename: string | null | undefined) => {
  if (!filename) return -1;
  return (SHOWCASE_WIDE_ORDER as readonly string[]).indexOf(filename);
};

/**
 * The six clips the front page shows, in grid order.
 *
 * Top row is landscape and abstract — establishing shots. Bottom row is people, shot with
 * deliberate camera language, because "can this thing make a professional clip" is the
 * question a visitor is actually asking.
 *
 * Also shipped in public/showcase/ and seeded alongside the stills.
 */
export const SHOWCASE_CLIP_ORDER = [
  'concrete-shadow.mp4',
  'forest-mist.mp4',
  'ink-water.mp4',
  'desert-dusk.mp4',
  'neon-rain.mp4',
  'studio-still.mp4',
] as const;

/** -1 for anything that is not one of the six. */
export const showcaseClipOrderOf = (filename: string | null | undefined) => {
  if (!filename) return -1;
  return (SHOWCASE_CLIP_ORDER as readonly string[]).indexOf(filename);
};

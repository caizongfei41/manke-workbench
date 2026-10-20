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
 * The nine wide frames the front page rotates, in the order they should appear.
 *
 * Naming beats counting: the project also holds older test renders, so the rotation asks for
 * these filenames by name instead of taking whatever happens to be newest.
 */
export const SHOWCASE_WIDE_ORDER = [
  'brutalist-light.png',
  'mist-forest.png',
  'crystal-still.png',
  'neon-rain.png',
  'desert-dusk.png',
  'ink-water.png',
  'steel-macro.png',
  'fractal-flow.png',
  'quiet-interior.png',
  'aurora-lake.png',
  'autumn-road.png',
  'marble-vein.png',
  'oil-rainbow.png',
  'snow-ridge.png',
  'copper-dust.png',
  'paper-fold.png',
  'tide-pool.png',
  'city-rain-lights.png',
  'silk-shadow.png',
  'model-studio-portrait.png',
  'model-window-light.png',
  'model-street-night.png',
  'model-golden-hour.png',
  'model-monochrome.png',
  'model-wind-coast.png',
  'model-studio-color.png',
  'model-rain-glass.png',
  'model-soft-smoke.png',
  'model-daylight-close.png',
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
 */
export const SHOWCASE_CLIP_ORDER = [
  'concrete-shadow.mp4',
  'forest-mist.mp4',
  'ink-water.mp4',
  'portrait-shallow-track.mp4',
  'portrait-low-angle-walk.mp4',
  'portrait-orbit-backlight.mp4',
] as const;

/** -1 for anything that is not one of the six. */
export const showcaseClipOrderOf = (filename: string | null | undefined) => {
  if (!filename) return -1;
  return (SHOWCASE_CLIP_ORDER as readonly string[]).indexOf(filename);
};

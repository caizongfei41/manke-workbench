/**
 * Choosing what the front page shows.
 *
 * The library is whatever the machine happened to render, including test output that a
 * visitor should never see first. A curated set lives in one project, and the page prefers
 * it: newest work from that project, then everything else.
 *
 * Two sets feed the front page:
 *
 *   Built-in  — ships in public/showcase/ and is seeded into the curated project on
 *               install, so a fresh machine has something to show. Users can hide an
 *               individual built-in by marking the asset hidden.
 *   Uploaded  — anything the user puts into the curated project from the UI. Those
 *               replace the empty slots instead of competing with the built-in set, so
 *               "replace that video" means exactly that.
 *
 * Ordering rule: user picks come first (newest first), then the remaining built-in
 * entries in the shipped order. An asset the user hid is never selected.
 */

/**
 * The project that holds the curated set. Kept in core because the name is content — the
 * component layer is not allowed to carry literal Chinese.
 */
export const SHOWCASE_PROJECT_NAME = '首页展示';

export type ShowcaseCandidate = {
  id: string;
  projectName?: string | null;
  filename?: string | null;
  metadata?: unknown;
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
 * Frames that ship with the app.
 *
 * These are the fallback rotation. The seeder writes matching rows into the curated
 * project so the page can go through the normal asset path — no special-casing on disk.
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

/** Clips that ship with the app, in the grid order they were chosen for. */
export const SHOWCASE_CLIP_ORDER = [
  'concrete-shadow.mp4',
  'forest-mist.mp4',
  'ink-water.mp4',
  'desert-dusk.mp4',
  'neon-rain.mp4',
  'studio-still.mp4',
] as const;

/** -1 for anything that is not part of the built-in rotation. */
export const showcaseOrderOf = (filename: string | null | undefined) => {
  if (!filename) return -1;
  return (SHOWCASE_WIDE_ORDER as readonly string[]).indexOf(filename);
};

/** -1 for anything that is not one of the built-in clips. */
export const showcaseClipOrderOf = (filename: string | null | undefined) => {
  if (!filename) return -1;
  return (SHOWCASE_CLIP_ORDER as readonly string[]).indexOf(filename);
};

/**
 * Read the per-asset showcase flags out of the metadata blob.
 *
 * The asset table already carries a free-form metadata column, so the UI does not need
 * a schema change to record "this frame was hidden from the front page" or "the user
 * pinned this to slot 2".
 */
const readFlags = (metadata: unknown) => {
  if (!metadata || typeof metadata !== 'object') return { hidden: false, order: null as number | null };
  const m = metadata as Record<string, unknown>;
  const showcase = (m.showcase ?? null) as Record<string, unknown> | null;
  if (!showcase) return { hidden: false, order: null as number | null };
  const hidden = showcase.hidden === true;
  const rawOrder = showcase.order;
  const order = typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : null;
  return { hidden, order };
};

/** True when the user took this asset off the front page. */
export const isHiddenFromShowcase = (item: ShowcaseCandidate) => readFlags(item.metadata).hidden;

/** Slot the user pinned this asset to, or null when it follows the default order. */
export const showcaseSlotOf = (item: ShowcaseCandidate) => readFlags(item.metadata).order;

/**
 * Pick the frames for the carousel.
 *
 * User uploads win: they are the deliberate choices, and the built-in set exists only so
 * the page is not empty. A hidden asset never appears. Among equals, an explicitly pinned
 * slot wins over filename order, and uploads sort before built-ins.
 */
export const rankShowcaseStill = <T extends ShowcaseCandidate>(items: T[]) =>
  [...items]
    .filter((item) => !isHiddenFromShowcase(item))
    .sort((left, right) => {
      const slotL = showcaseSlotOf(left);
      const slotR = showcaseSlotOf(right);
      if (slotL !== null && slotR !== null) return slotL - slotR;
      if (slotL !== null) return -1;
      if (slotR !== null) return 1;

      const orderL = showcaseOrderOf(left.filename);
      const orderR = showcaseOrderOf(right.filename);
      // Uploads have no built-in position; put them ahead of the shipped rotation.
      if (orderL < 0 && orderR >= 0) return -1;
      if (orderR < 0 && orderL >= 0) return 1;
      if (orderL >= 0 && orderR >= 0) return orderL - orderR;
      return 0;
    });

/** Same rule for the clip grid. */
export const rankShowcaseClip = <T extends ShowcaseCandidate>(items: T[]) =>
  [...items]
    .filter((item) => !isHiddenFromShowcase(item))
    .sort((left, right) => {
      const slotL = showcaseSlotOf(left);
      const slotR = showcaseSlotOf(right);
      if (slotL !== null && slotR !== null) return slotL - slotR;
      if (slotL !== null) return -1;
      if (slotR !== null) return 1;

      const orderL = showcaseClipOrderOf(left.filename);
      const orderR = showcaseClipOrderOf(right.filename);
      if (orderL < 0 && orderR >= 0) return -1;
      if (orderR < 0 && orderL >= 0) return 1;
      if (orderL >= 0 && orderR >= 0) return orderL - orderR;
      return 0;
    });

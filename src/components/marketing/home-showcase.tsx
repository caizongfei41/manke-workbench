import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, Pause, Play, Sparkles } from 'lucide-react';

import { normalizeLocale } from '@/config/locale';
import { Link } from '@/core/i18n/navigation';
import { SHOWCASE_PROJECT_NAME, rankShowcaseClip, rankShowcaseStill } from '@/core/showcase/curation';

/** The curated set is hand-picked, so it skips the variance filter the raw library needs. */
const isCuratedEntry = (asset: { projectName?: string | null }) =>
  asset.projectName === SHOWCASE_PROJECT_NAME;
import { m } from '@/paraglide/messages.js';

/**
 * The showcase is fed by this machine's own library, not by stock photography.
 *
 * A product that generates images should prove it on its own front page: whatever was
 * made here last is what a visitor sees first. When the library is empty the sections
 * degrade to gradient plates rather than breaking the layout.
 */

type Shot = {
  id: string;
  url: string;
  label: string;
  poster?: string | null;
  width: number | null;
  height: number | null;
};

const ROTATE_MS = 4200;
const MAX_IMAGES = 40;
const CANDIDATES = 40;
const MAX_CLIPS = 6;
const CLIP_CANDIDATES = 8;

const copy = (locale: string) => {
  const messageLocale = normalizeLocale(locale);
  return {
    galleryTitle: m['home.showcase.title']({}, { locale: messageLocale }),
    gallerySubtitle: m['home.showcase.subtitle']({}, { locale: messageLocale }),
    videoTitle: m['home.showcase.videoTitle']({}, { locale: messageLocale }),
    videoSubtitle: m['home.showcase.videoSubtitle']({}, { locale: messageLocale }),
    empty: m['home.showcase.empty']({}, { locale: messageLocale }),
    pause: m['home.showcase.pause']({}, { locale: messageLocale }),
    play: m['home.showcase.play']({}, { locale: messageLocale }),
    untitled: m['home.showcase.untitled']({}, { locale: messageLocale }),
    manage: m['home.showcase.manage']({}, { locale: messageLocale }),
  };
};

/**
 * Keep an image only if the browser can decode it *and* it actually shows something.
 *
 * The library is full of flat single-colour renders from test runs, and a landing page that
 * rotates through solid blue blocks says less than one with three real frames.
 */
const preload = (url: string) =>
  new Promise<{ url: string; variance: number } | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ url, variance: measureVariance(image) });
    image.onerror = () => resolve(null);
    image.src = url;
  });

/** Standard deviation of luminance over a 32×32 sample; near zero means a flat fill. */
const measureVariance = (image: HTMLImageElement) => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(image, 0, 0, 32, 32);
    const { data } = context.getImageData(0, 0, 32, 32);
    let sum = 0;
    let sumSquares = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += luma;
      sumSquares += luma * luma;
    }
    const mean = sum / pixels;
    return Math.sqrt(Math.max(0, sumSquares / pixels - mean * mean));
  } catch {
    return 0;
  }
};

const MIN_VARIANCE = 3.5;

/** Mean absolute difference between two luminance grids; below this the frames match. */
const looksSame = (a: number[], b: number[]) => {
  if (!a.length || !b.length) return false;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length < 6;
};

/** Pull a frame out of a clip, so the gallery is full even when few stills survive. */
type Frame = { frame: string; signature: number[] };

const grabFrame = (url: string) =>
  new Promise<Frame | null>((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (value: Frame | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    video.src = `${url}#t=0.4`;
    video.muted = true;
    video.preload = 'auto';
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.4, (video.duration || 1) / 2);
      } catch {
        draw();
      }
    };
    video.onseeked = () => draw();
    video.onerror = () => finish(null);
    const draw = () => {
      try {
        const canvas = document.createElement('canvas');
        const width = Math.min(video.videoWidth || 640, 1280);
        const height = Math.round((width * (video.videoHeight || 360)) / (video.videoWidth || 640));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return finish(null);
        context.drawImage(video, 0, 0, width, height);

        // A 4×4 luminance grid is enough to tell "another take of the same shot" from
        // "something new", and the library is full of repeated takes.
        const thumb = document.createElement('canvas');
        thumb.width = 4;
        thumb.height = 4;
        const thumbContext = thumb.getContext('2d');
        if (!thumbContext) return finish(null);
        thumbContext.drawImage(video, 0, 0, 4, 4);
        const { data } = thumbContext.getImageData(0, 0, 4, 4);
        const signature: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
          signature.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        }

        finish({ frame: canvas.toDataURL('image/jpeg', 0.82), signature });
      } catch {
        finish(null);
      }
    };
    setTimeout(() => finish(null), 9000);
  });

export function HomeShowcase({ locale }: { locale: string }) {
  const text = copy(locale);
  const [images, setImages] = useState<Shot[]>([]);
  const [clips, setClips] = useState<Shot[]>([]);
  const [brokenIds, setBrokenIds] = useState<Record<string, true>>({});
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/app/recent-assets?limit=80', {
          headers: { 'x-beatapi-workspace-request': '1' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as {
          images?: {
            id: string;
            publicUrl: string | null;
            filename?: string | null;
            projectName?: string | null;
            metadata?: unknown;
          }[];
          videos?: {
            id: string;
            publicUrl: string | null;
            filename?: string | null;
            projectName?: string | null;
            metadata?: unknown;
          }[];
        };

        // Only the showcase project qualifies; everything else is somebody's test output.
        //
        // Within that project the user's own uploads come first, then whatever is left of
        // the shipped set — that is what makes "replace this video" mean the thing they
        // uploaded rather than an extra card next to it. rankShowcase* also drops frames
        // the user hid, which is how a built-in one gets swapped out for good.
        const imageCandidates = rankShowcaseStill(
          (payload.images ?? []).filter(
            (asset) => asset.publicUrl && asset.projectName === SHOWCASE_PROJECT_NAME
          )
        );
        const checked = await Promise.all(
          imageCandidates.map(async (asset) => ({
            asset,
            ok: asset.publicUrl ? await preload(asset.publicUrl) : null,
          }))
        );
        if (cancelled) return;

        // Keep the ranked order: it already encodes the user's intent. The variance sort
        // is only a tie-break for uploads that have no built-in position.
        const stills: Shot[] = checked
          .filter((entry) => entry.ok)
          .slice(0, MAX_IMAGES)
          .map(({ asset }) => ({
            id: asset.id,
            url: asset.publicUrl as string,
            label: asset.projectName ?? text.untitled,
            width: null,
            height: null,
          }));

        // Fill the remainder from real clips: the frames are earned, not stock.
        if (stills.length < MAX_IMAGES) {
          const spare = rankShowcaseClip(
            (payload.videos ?? []).filter(
              (asset) => asset.publicUrl && asset.projectName === SHOWCASE_PROJECT_NAME
            )
          ).slice(0, MAX_IMAGES - stills.length + 2);
          const frames = await Promise.all(
            spare.map(async (asset) => ({
              asset,
              frame: (await grabFrame(asset.publicUrl as string))?.frame ?? null,
            }))
          );
          if (cancelled) return;
          for (const { asset, frame } of frames) {
            if (!frame || stills.length >= MAX_IMAGES) continue;
            stills.push({
              id: `frame-${asset.id}`,
              url: frame,
              label: asset.projectName ?? text.untitled,
              width: null,
              height: null,
            });
          }
        }

        setImages(stills);
        // Same rule as the stills: only the curated project, user picks first, hidden
        // entries dropped. The shipped six are the fallback grid.
        const clipRows = rankShowcaseClip(
          (payload.videos ?? []).filter(
            (asset) => asset.publicUrl && asset.projectName === SHOWCASE_PROJECT_NAME
          )
        ).slice(0, MAX_CLIPS);
        const withPoster = await Promise.all(
          clipRows.map(async (asset) => {
            const grabbed = await grabFrame(asset.publicUrl as string);
            return {
            id: asset.id,
            url: asset.publicUrl as string,
            label: asset.projectName ?? text.untitled,
            poster: grabbed?.frame ?? null,
            signature: grabbed?.signature ?? null,
            width: null,
              height: null,
            };
          })
        );
        if (cancelled) return;
        // The curated row is already hand-picked and distinct, so it is not deduped: doing so
        // silently shrank four chosen clips down to two.
        const uniqueClips = withPoster.slice(0, MAX_CLIPS);
        setClips(uniqueClips);
        setReady(true);
      } catch {
        if (!cancelled) setReady(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rotation stops while the pointer is over the frame, and for reduced-motion users.

  const playClip = useCallback(async (id: string) => {
    const el = videoRefs.current[id];
    if (!el) return;
    try {
      el.muted = true;
      await el.play();
    } catch {
      // Autoplay can be refused; the poster frame is still a useful preview.
    }
  }, []);

  const pauseClip = useCallback((id: string) => {
    const el = videoRefs.current[id];
    if (el) el.pause();
  }, []);

  // The set can shrink between loads (a broken frame dropping out), so never trust the
  // stored index to still be in range.
  // Keep every curated frame in the rotation. A frame that fails to decode is skipped by
  // the strip, but removing it here made the count wobble between renders.
  const visible = images;

  // The curated set loops on a timer. All frames stay mounted; only the index moves.
  useEffect(() => {
    if (visible.length < 2 || paused) return;
    const id = setInterval(() => {
      setActive((current) => (current + 1) % Math.max(visible.length, 1));
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [visible.length, paused]);

  const safeActive = visible.length ? Math.min(active, visible.length - 1) : 0;
  const heroShot = visible[safeActive] ?? null;

  // Stack geometry: the main frame owns the middle half; each side card steps outward by
  // half of both widths plus a gap, so the fan is symmetric at every depth.
  // Budget the full stage width: the main frame takes the middle, three side cards each
  // side take the rest, and the leftover is the gap between them. Nothing can overflow
  // because the total is the container width by construction.
  // Percentages of the stage width. Total footprint must stay under 100:
  //   main + 2*(side1+side2+side3) + 2*3*gap <= 100
  const GAP = 1;
  const MAIN_WIDTH = 34;
  const SIDE_WIDTH = [0, 12, 9, 7];
  // 34 + 2*(28) + 6 = 96 — four percent of slack for the shadow.
  const SIDE_HEIGHT = [0, 78, 62, 48];
  const SIDE_LEFT = (() => {
    const out = [0, 0, 0, 0];
    let edge = MAIN_WIDTH / 2;
    for (let d = 1; d <= 3; d += 1) {
      out[d] = edge + SIDE_WIDTH[d] / 2 + GAP;
      edge = out[d] + SIDE_WIDTH[d] / 2;
    }
    return out;
  })();
  const strip = useMemo(() => images.filter((_, index) => index !== active).slice(0, 4), [images, active]);

  return (
    <div className="relative">
      {/* Rotation stage */}
      <section className="relative mt-12" aria-label={text.galleryTitle}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="beat-product-display text-[28px] font-semibold tracking-[-0.03em] text-[var(--beat-text-1)] sm:text-[24px]">
              {text.galleryTitle}
            </h2>
            <p className="mt-2 max-w-xl text-[16px] leading-7 text-[var(--beat-text-2)]">
              {text.gallerySubtitle}
            </p>
          </div>
          {/* Curation lives on its own page: the first screenful is the product, not
              a control panel. One quiet link is enough of a door. */}
          <Link
            href="/showcase"
            className="shrink-0 text-[13px] text-[var(--beat-text-3)] underline-offset-4 transition hover:text-[var(--beat-text-2)] hover:underline"
            data-showcase-manage-link="true"
          >
            {text.manage}
          </Link>

        </div>

        <div
          className="beat-glass relative overflow-hidden rounded-[24px] p-2"
          data-showcase-stage="true"
        >
          <div className="relative h-[clamp(340px,30vw,460px)] w-full overflow-hidden rounded-[18px] bg-[var(--beat-surface-2)]">
            {images.length === 0 ? (
              <div className="grid size-full place-items-center">
                <div className="text-center">
                  <Sparkles className="mx-auto size-6 text-[var(--beat-text-3)]" />
                  <p className="mt-3 text-[15px] text-[var(--beat-text-2)]" data-showcase-empty="true">
                    {ready ? text.empty : ' '}
                  </p>
                </div>
              </div>
            ) : null}
            <>
                {visible.map((shot, index) => {
                  const offset = index - safeActive;
                  const depth = Math.abs(offset);
                  // A short stack either side: past three the cards are hairlines and gain nothing.
                  if (depth > 3) return null;
                  return (
                    <button
                      key={shot.id}
                      type="button"
                      onClick={() => setActive(index)}
                      aria-label={`${index + 1}`}
                      data-showcase-frame={depth === 0 ? 'active' : 'idle'}
                      data-showcase-depth={depth}
                      className="absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-[16px] border border-white/10 bg-[var(--beat-surface-2)] shadow-[0_18px_50px_-24px_rgba(0,0,0,0.65)] transition-all duration-[820ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{
                        left: `${50 + Math.sign(offset) * (SIDE_LEFT[depth] ?? 0)}%`,
                        width: `${depth === 0 ? MAIN_WIDTH : (SIDE_WIDTH[depth] ?? SIDE_WIDTH[3])}%`,
                        height: `${depth === 0 ? 100 : (SIDE_HEIGHT[depth] ?? SIDE_HEIGHT[3])}%`,
                        zIndex: 30 - depth,
                        transform: 'translateX(-50%)',
                        opacity: depth === 3 ? 0.6 : 1,
                        filter: depth === 0 ? 'none' : `brightness(${1 - Math.min(depth, 3) * 0.18})`,
                      }}
                    >
                      <img
                        src={shot.url}
                        alt=""
                        onError={() => {
                          setBrokenIds((current) => ({ ...current, [shot.id]: true }));
                        }}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  );
                })}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-5 sm:p-7">
                  <span
                    className="rounded-full border border-white/25 bg-black/55 px-3.5 py-1.5 text-[15px] font-medium text-white backdrop-blur-md"
                    data-showcase-caption="true"
                  >
                    {heroShot?.label ?? ''}
                  </span>
                  <span className="flex items-center gap-1.5" data-showcase-dots="true">
                    {visible.map((shot, index) => (
                      <button
                        key={shot.id}
                        type="button"
                        onClick={() => setActive(index)}
                        aria-label={`${index + 1}`}
                        aria-current={index === safeActive}
                        className={`h-2 rounded-full transition-all ${
                          index === safeActive ? 'w-7 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'
                        }`}
                      />
                    ))}
                  </span>
                </div>
              </>
            {images.length === 0 ? (
              <div className="grid size-full place-items-center">
                <div className="text-center">
                  <Sparkles className="mx-auto size-6 text-[var(--beat-text-3)]" />
                  <p className="mt-3 text-[15px] text-[var(--beat-text-2)]" data-showcase-empty="true">
                    {ready ? text.empty : ' '}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

        </div>
      </section>

      {/* Clips */}
      <section className="relative mt-16" aria-label={text.videoTitle}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="beat-product-display text-[20px] font-semibold tracking-[-0.03em] text-[var(--beat-text-1)] sm:text-[24px]">
              {text.videoTitle}
            </h2>
            <p className="mt-1.5 max-w-xl text-[15px] leading-6 text-[var(--beat-text-2)]">
              {text.videoSubtitle}
            </p>
          </div>
        </div>

        {clips.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-showcase-clips="true">
            {clips.map((clip, index) => (
              <figure
                key={clip.id}
                className="beat-glass group relative overflow-hidden rounded-[18px] p-1.5"
                onMouseEnter={() => void playClip(clip.id)}
                onMouseLeave={() => pauseClip(clip.id)}
              >
                <div className="relative aspect-video overflow-hidden rounded-[13px] bg-[var(--beat-surface-2)]">
                  <video
                    ref={(node) => {
                      videoRefs.current[clip.id] = node;
                    }}
                    src={`${clip.url}#t=0.1`}
                    poster={clip.poster ?? undefined}
                    muted
                    loop
                    playsInline
                    preload={index < 3 ? 'metadata' : 'none'}
                    onMouseEnter={() => void playClip(clip.id)}
                    data-showcase-clip={clip.id}
                    className="size-full object-cover"
                  />
                  <span className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="grid size-10 place-items-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-md transition group-hover:scale-90 group-hover:opacity-0">
                      <Play className="size-4" />
                    </span>
                  </span>
                  <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-1.5 pt-6 text-[15px] text-white">
                    {clip.label}
                  </figcaption>
                </div>
              </figure>
            ))}
          </div>
        ) : (
          <div className="beat-glass flex min-h-[160px] items-center justify-center rounded-[18px]">
            <p className="flex items-center gap-2 text-[15px] text-[var(--beat-text-2)]" data-showcase-clips-empty="true">
              <ImageIcon className="size-4" />
              {ready ? text.empty : ' '}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

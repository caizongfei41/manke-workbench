import { useEffect, useState } from 'react';

import { HintTip } from '@/components/app/hint-tip';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

/** The four surfaces a new project can start in. */
export type StartMode = 'image' | 'video' | 'audio' | 'analysis';

type StartEntry = {
  mode: StartMode;
  className: string;
  key: StartMode;
};

// These used to be four decorative stills whose only effect was filling the
// composer with a canned prompt. They are now the way into each part of the
// workbench, so the picture, the label and the destination all describe the same
// thing.
const START_ENTRIES: StartEntry[] = [
  {
    mode: 'image',
    className:
      'left-0 top-[18px] size-[90px] rotate-[-8deg] rounded-[14px] sm:left-[22px] sm:top-[14px] sm:size-[132px]',
    key: 'image',
  },
  {
    mode: 'video',
    className:
      'left-[82px] top-[2px] size-[102px] rotate-[3deg] rounded-[17px] sm:left-[134px] sm:top-0 sm:size-[132px]',
    key: 'video',
  },
  {
    mode: 'audio',
    className:
      'left-[172px] top-[10px] size-[96px] rounded-full sm:left-[250px] sm:top-[4px] sm:size-[126px]',
    key: 'audio',
  },
  {
    mode: 'analysis',
    className:
      'right-0 top-[16px] size-[98px] rotate-[6deg] rounded-[14px] sm:right-[6px] sm:top-[12px] sm:size-[128px]',
    key: 'analysis',
  },
];

const THUMBS: Record<StartMode, string> = {
  image: '/app/create-thumb-image.webp',
  video: '/app/create-thumb-video.webp',
  audio: '/app/create-thumb-audio.webp',
  analysis: '/app/create-thumb-analysis.webp',
};

const MODE_NAMES = {
  image: () => m['startHere.image.name'](),
  video: () => m['startHere.video.name'](),
  audio: () => m['startHere.audio.name'](),
  analysis: () => m['startHere.analysis.name'](),
};

// Seed prompt per entry; kept in the catalogs so the copy stays translatable.
const SEED_PROMPTS = {
  image: () => m['startHere.image.prompt'](),
  video: () => m['startHere.video.prompt'](),
  audio: () => m['startHere.audio.prompt'](),
  analysis: () => m['startHere.analysis.prompt'](),
};

const MODE_DESCS = {
  image: () => m['startHere.image.desc'](),
  video: () => m['startHere.video.desc'](),
  audio: () => m['startHere.audio.desc'](),
  analysis: () => m['startHere.analysis.desc'](),
};

const STYLE_STARTERS = [
  { key: 'cinematic', label: () => m['startHere.style.cinematic'](), prompt: () => m['startHere.style.cinematicPrompt']() },
  { key: 'ink', label: () => m['startHere.style.ink'](), prompt: () => m['startHere.style.inkPrompt']() },
  { key: 'product', label: () => m['startHere.style.product'](), prompt: () => m['startHere.style.productPrompt']() },
  { key: 'arch', label: () => m['startHere.style.arch'](), prompt: () => m['startHere.style.archPrompt']() },
  { key: 'neon', label: () => m['startHere.style.neon'](), prompt: () => m['startHere.style.neonPrompt']() },
  { key: 'film', label: () => m['startHere.style.film'](), prompt: () => m['startHere.style.filmPrompt']() },
];

export function StudioStartHere({
  onPickMode,
  projectId,
}: {
  /**
   * Runs the entry. The studio switches its media tab; the canvas opens a draft
   * or routes to the studio. Omitted on surfaces with nowhere to go, in which
   * case the cards only show their selected state.
   */
  onPickMode?: (mode: StartMode, prompt: string) => void;
  /** Shows this project recent output; omitted when there is no project */
  projectId?: string;
} = {}) {
  const [selected, setSelected] = useState<StartMode | null>(null);
  const [pickedStyle, setPickedStyle] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/app/recent-assets?projectId=${encodeURIComponent(projectId)}&limit=8`,
          { headers: { 'x-beatapi-workspace-request': '1' } }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { images?: { publicUrl: string | null }[] };
        if (cancelled) return;
        setRecent(
          (payload.images ?? [])
            .map((asset) => asset.publicUrl)
            .filter((url): url is string => Boolean(url))
            .slice(0, 6)
        );
      } catch {
        // Recent output is a nicety: if it cannot be read, show nothing
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // The empty studio is mostly blank space. Fill it with what this machine has actually
  // made, so a new project starts next to evidence rather than next to nothing.
  const [galleryShots, setGalleryShots] = useState<{ id: string; url: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
    const response = await fetch('/api/app/recent-assets?limit=60', {
      headers: { 'x-beatapi-workspace-request': '1' },
    }).catch(() => null);
    const payload = (response?.ok
      ? await response.json().catch(() => null)
      : null) as { images?: { id: string; publicUrl: string | null }[] } | null;
    {
        if (cancelled || !payload) return;
        const shots = (payload.images ?? [])
          .filter((asset) => asset.publicUrl)
          .map((asset) => ({ id: asset.id, url: String(asset.publicUrl) }));

        // Drop frames that are one flat colour: this renderer emits them on failure and
        // they are not what "made on this machine" should advertise.
        const keep: { id: string; url: string }[] = [];
        for (const shot of shots) {
          if (keep.length >= 5) break;
          const ok = await new Promise<boolean>((resolve) => {
            const img = new Image();
            img.onload = () => {
              try {
                const canvas = document.createElement('canvas');
                canvas.width = 24;
                canvas.height = 24;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(true);
                ctx.drawImage(img, 0, 0, 24, 24);
                const { data } = ctx.getImageData(0, 0, 24, 24);
                let min = 255;
                let max = 0;
                for (let i = 0; i < data.length; i += 4) {
                  const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                  if (luma < min) min = luma;
                  if (luma > max) max = luma;
                }
                resolve(max - min >= 3);
              } catch {
                resolve(true);
              }
            };
            img.onerror = () => resolve(false);
            img.src = shot.url;
          });
          if (ok) keep.push(shot);
        }
        if (!cancelled) setGalleryShots(keep);
    }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pointer-events-auto w-[min(94vw,1080px)] text-center" data-start-here="true">
      <div
        aria-label={m['startHere.groupLabel']()}
        className="relative mx-auto h-[122px] w-[min(88vw,350px)] sm:h-[148px] sm:w-[500px]"
      >
        <div className="pointer-events-none absolute inset-0 opacity-45 blur-[42px]">
          {START_ENTRIES.map((entry) => (
            <img
              key={`glow-${entry.mode}`}
              src={THUMBS[entry.mode]}
              alt=""
              className={`absolute border-[6px] border-[#6b6b72]/75 object-cover shadow-[var(--beat-photo-shadow)] ${entry.className}`}
            />
          ))}
        </div>

        {START_ENTRIES.map((entry) => {
          const isSelected = selected === entry.mode;
          const hasSelection = selected !== null;
          const name = MODE_NAMES[entry.key]();

          return (
            <HintTip
              key={entry.mode}
              label={name}
              description={MODE_DESCS[entry.key]()}
              className={cn('absolute', entry.className)}
            >
              <button
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={isSelected}
                data-start-mode={entry.mode}
                onClick={() => {
                  setSelected(entry.mode);
                  onPickMode?.(entry.mode, SEED_PROMPTS[entry.mode]());
                }}
                className={cn(
                  'group absolute inset-0 overflow-hidden border-[6px] border-[#6b6b72]/85 bg-[var(--beat-surface)] object-cover shadow-[0_18px_48px_rgba(0,0,0,0.4)] transition-[transform,border-color,filter,box-shadow,opacity] duration-300 ease-out hover:z-20 hover:scale-[1.045] hover:border-ink/65 hover:brightness-100 hover:opacity-100 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]',
                  isSelected &&
                    'z-20 scale-[1.06] border-ink/85 brightness-[1.14] shadow-[var(--beat-photo-shadow-active)]',
                  hasSelection && !isSelected && 'brightness-[0.72] opacity-70'
                )}
              >
                <img
                  src={THUMBS[entry.mode]}
                  alt=""
                  className={cn(
                    'h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105',
                    isSelected && 'scale-105'
                  )}
                />
              </button>
            </HintTip>
          );
        })}
      </div>

      {/* Names under the stack: four thumbnails alone do not say what they open. */}
      <ul className="mx-auto mt-4 flex max-w-[560px] flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-ink/45">
        {START_ENTRIES.map((entry) => (
          <li key={`label-${entry.mode}`} className="flex items-center gap-1.5">
            <span
              className={cn(
                'size-1.5 rounded-full',
                selected === entry.mode ? 'bg-[#38bdf8]' : 'bg-ink/25'
              )}
            />
            <span className={cn(selected === entry.mode && 'text-ink/80')}>
              {MODE_NAMES[entry.key]()}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-ink/30">{m['startHere.caption']()}</p>

      <h1 className="mt-6 text-[1.7rem] font-semibold leading-none tracking-[-0.035em] text-ink sm:text-[2.15rem]">
        {m['startHere.heading']()}
      </h1>
      <p className="mx-auto mt-3 max-w-[390px] text-[13px] leading-6 text-ink/35 sm:text-sm">
        {m['startHere.subheading']()}
      </p>

      {/* What this machine has made, so the empty state is not just whitespace */}
      {galleryShots.length > 0 ? (
        <div className="mt-9" data-start-gallery="true">
          <p className="text-[13px] font-semibold tracking-[0.16em] text-ink/30">
            {m['startHere.galleryTitle']()}
          </p>
          <div className="mt-3 flex items-stretch justify-center gap-3">
            {galleryShots.map((shot) => (
              <div
                key={shot.id}
                className="beat-glass relative h-[92px] flex-1 overflow-hidden rounded-[14px] sm:h-[112px]"
              >
                <img
                  src={shot.url}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    const frame = event.currentTarget.parentElement;
                    if (frame) frame.style.display = 'none';
                  }}
                  className="size-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Style starters: one click fills the prompt instead of an empty box */}
      <div className="mx-auto mt-7 max-w-[720px]">
        <p className="text-[14px] font-semibold tracking-[0.16em] text-ink/30">
          {m['startHere.styles.title']()}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2" data-style-starters="true">
          {STYLE_STARTERS.map((style) => (
            <button
              key={style.key}
              type="button"
              data-style-starter={style.key}
              onClick={() => {
                setPickedStyle(style.key);
                onPickMode?.('image', style.prompt());
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[13px] transition',
                pickedStyle === style.key
                  ? 'border-[var(--beat-accent)]/60 bg-[var(--beat-accent)]/12 text-[var(--beat-text-1)]'
                  : 'border-ink/[0.12] text-[var(--beat-text-2)] hover:border-ink/30 hover:text-ink'
              )}
            >
              {style.label()}
            </button>
          ))}
        </div>
      </div>

      {recent.length > 0 ? (
        <div className="mx-auto mt-8 max-w-[620px]" data-studio-recent="true">
          <p className="text-[14px] font-semibold tracking-[0.16em] text-ink/30">
            {m['startHere.recent.title']()}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {recent.map((url, index) => (
              <img
                key={url}
                src={url}
                alt=""
                data-studio-recent-item={index}
                className="aspect-[4/3] w-full rounded-[12px] border border-ink/[0.1] object-cover opacity-85 transition duration-300 hover:scale-[1.02] hover:opacity-100"
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* What this machine can do — the empty state had a slab of dead space below the
          starters, and this is the honest thing to put there. */}
      <div className="mx-auto mt-10 grid max-w-[900px] gap-3 text-left sm:grid-cols-3" data-start-capabilities="true">
        {[
          {
            key: 'image',
            title: m['startHere.capability.image'](),
            body: m['startHere.capability.imageBody'](),
          },
          {
            key: 'video',
            title: m['startHere.capability.video'](),
            body: m['startHere.capability.videoBody'](),
          },
          {
            key: 'music',
            title: m['startHere.capability.music'](),
            body: m['startHere.capability.musicBody'](),
          },
        ].map((item) => (
          <div
            key={item.key}
            className="rounded-[14px] border border-ink/[0.08] bg-[var(--beat-surface)]/60 px-4 py-3.5"
          >
            <p className="text-[13.5px] font-semibold text-[var(--beat-text-1)]">{item.title}</p>
            <p className="mt-1 text-[13px] leading-6 text-[var(--beat-text-2)]">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

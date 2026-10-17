import { useState } from 'react';

import { HintTip } from '@/components/app/hint-tip';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

type StudioStartHereIdea = {
  className: string;
  src: string;
  /** i18n key prefix; short name and one-line description live in messages. */
  key: 'cinematic' | 'character' | 'material' | 'surreal';
  /** Seed prompt dropped into the composer when the idea is picked. */
  prompt: string;
};

// The prompt is the point of these cards: picking one used to do nothing beyond
// highlighting the thumbnail, which made the whole row a dead end.
const STUDIO_START_HERE_IDEAS: StudioStartHereIdea[] = [
  {
    className:
      'left-0 top-[18px] size-[90px] rotate-[-8deg] rounded-[14px] sm:left-[22px] sm:top-[14px] sm:size-[132px]',
    src: '/app/create-thumb-forest.webp',
    key: 'cinematic',
    prompt:
      'A lone figure on a misty ridge at golden hour, layered mountains fading into haze, cinematic wide shot, volumetric light, 35mm film grain, muted teal and amber palette',
  },
  {
    className:
      'left-[82px] top-[2px] size-[102px] rotate-[3deg] rounded-[17px] sm:left-[134px] sm:top-0 sm:size-[132px]',
    src: '/app/create-thumb-character.webp',
    key: 'character',
    prompt:
      'Studio portrait of a woman in a structured ivory blazer, seamless warm grey backdrop, soft key light from the left, editorial fashion photography, medium format, shallow depth of field',
  },
  {
    className:
      'left-[172px] top-[10px] size-[96px] rounded-full sm:left-[250px] sm:top-[4px] sm:size-[126px]',
    src: '/app/create-thumb-texture.webp',
    key: 'material',
    prompt:
      'Extreme close-up of brushed aluminium meeting frosted glass, raking side light revealing micro texture, minimal industrial material study, high detail, neutral palette',
  },
  {
    className:
      'right-0 top-[16px] size-[98px] rotate-[6deg] rounded-[14px] sm:right-[6px] sm:top-[12px] sm:size-[128px]',
    src: '/app/create-thumb-mask.webp',
    key: 'surreal',
    prompt:
      'Surreal fashion film still, model in sculptural white couture against a dark void, single hard light, floating fabric, dreamlike, high contrast with a single red accent',
  },
];

const IDEA_NAMES = {
  cinematic: () => m['studio.idea.cinematic.name'](),
  character: () => m['studio.idea.character.name'](),
  material: () => m['studio.idea.material.name'](),
  surreal: () => m['studio.idea.surreal.name'](),
};

const IDEA_DESCS = {
  cinematic: () => m['studio.idea.cinematic.desc'](),
  character: () => m['studio.idea.character.desc'](),
  material: () => m['studio.idea.material.desc'](),
  surreal: () => m['studio.idea.surreal.desc'](),
};

export function StudioStartHere({
  onPickIdea,
}: {
  /**
   * Called with the idea's seed prompt. The studio drops it into the composer;
   * the canvas opens a new draft card with it. Omitted on surfaces with nowhere
   * to put a prompt, in which case the cards only show their selection state.
   */
  onPickIdea?: (prompt: string) => void;
} = {}) {
  const [selectedSrc, setSelectedSrc] = useState<string | null>(null);

  return (
    <div className="pointer-events-auto w-[min(94vw,620px)] text-center">
      <div
        aria-label="Starting ideas"
        className="relative mx-auto h-[122px] w-[min(88vw,350px)] sm:h-[148px] sm:w-[500px]"
      >
        <div className="pointer-events-none absolute inset-0 opacity-45 blur-[42px]">
          {STUDIO_START_HERE_IDEAS.map((idea) => (
            <img
              key={`glow-${idea.src}`}
              src={idea.src}
              alt=""
              className={`absolute border-[6px] border-[#6b6b72]/75 object-cover shadow-[0_18px_52px_rgba(0,0,0,0.45)] ${idea.className}`}
            />
          ))}
        </div>

        {STUDIO_START_HERE_IDEAS.map((idea) => {
          const isSelected = selectedSrc === idea.src;
          const hasSelection = selectedSrc !== null;
          const name = IDEA_NAMES[idea.key]();

          return (
            <HintTip
              key={idea.src}
              label={name}
              description={IDEA_DESCS[idea.key]()}
              className={cn('absolute', idea.className)}
            >
              <button
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedSrc(idea.src);
                  onPickIdea?.(idea.prompt);
                }}
                className={cn(
                  'group absolute inset-0 overflow-hidden border-[6px] border-[#6b6b72]/85 bg-[var(--beat-surface)] object-cover shadow-[0_18px_48px_rgba(0,0,0,0.4)] transition-[transform,border-color,filter,box-shadow,opacity] duration-300 ease-out hover:z-20 hover:scale-[1.045] hover:border-ink/65 hover:brightness-100 hover:opacity-100 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]',
                  isSelected &&
                    'z-20 scale-[1.06] border-ink/85 brightness-[1.14] shadow-[0_24px_62px_rgba(0,0,0,0.58),0_0_0_2px_rgba(255,255,255,0.12)]',
                  hasSelection && !isSelected && 'brightness-[0.72] opacity-70'
                )}
              >
                <img
                  src={idea.src}
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

      {/* Names under the stack: four thumbnails alone do not say what they are. */}
      <ul className="mx-auto mt-4 flex max-w-[560px] flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px] text-ink/45">
        {STUDIO_START_HERE_IDEAS.map((idea) => (
          <li key={`label-${idea.src}`} className="flex items-center gap-1.5">
            <span
              className={cn(
                'size-1.5 rounded-full',
                selectedSrc === idea.src ? 'bg-[#38bdf8]' : 'bg-ink/25'
              )}
            />
            <span className={cn(selectedSrc === idea.src && 'text-ink/80')}>
              {IDEA_NAMES[idea.key]()}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-ink/30">
        {m['studio.startHere.caption']()}
      </p>

      <h1 className="mt-6 text-[1.7rem] font-semibold leading-none tracking-[-0.035em] text-ink sm:text-[2.15rem]">
        Create Here
      </h1>
      <p className="mx-auto mt-3 max-w-[390px] text-[13px] leading-6 text-ink/35 sm:text-sm">
        Imagine the scene. Shape the mood. Bring it to life.
      </p>
    </div>
  );
}

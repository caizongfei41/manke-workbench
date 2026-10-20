import { AlertTriangle, ChevronDown, FileText, Music2, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { HintTip } from '@/components/app/hint-tip';
import { WorkspaceSelect } from '@/components/app/workspace-select';
import {
  MUSIC_GROUP_BLURB,
  isFieldLockedByRecipe,
  isRecipeActive,
  MUSIC_LYRICS_EXAMPLES,
  MUSIC_STYLE_FIELDS,
  MUSIC_STYLE_GROUP_LABELS,
  summarizeMusicStyle,
  type MusicLyricsExample,
  type MusicStyleField,
  type MusicStyleGroup,
} from '@/core/effects/music-style';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

type MusicStyleValue = Record<string, string | number>;

const GROUPS: MusicStyleGroup[] = ['core', 'voice', 'arrange', 'extra'];

/** One labelled cell. The label sits above the control: a bare value pill says nothing. */
function FieldCell({
  field,
  current,
  onChange,
  disabled,
  locked = false,
}: {
  field: MusicStyleField;
  current: string | number;
  onChange: (next: string | number) => void;
  disabled: boolean;
  /** Overridden by the style recipe: the control is read-only. */
  locked?: boolean;
}) {
  const isLocked = disabled || locked;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', locked && 'opacity-45')}>
      <span className="truncate text-[13px] leading-none text-[var(--beat-text-2)]">
        {field.label}
      </span>
      <HintTip label={field.label} description={field.hint} className="min-w-0">
        {field.type === 'select' && field.options ? (
          <WorkspaceSelect
            ariaLabel={field.label}
            triggerClassName="w-full"
            value={String(current)}
            options={field.options.map((option) => ({
              value: option,
              label: option.split(' / ')[0],
            }))}
            onChange={(next) => onChange(next)}
          />
        ) : field.type === 'number' ? (
          <input
            type="number"
            value={Number(current)}
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={isLocked}
            onChange={(event) => onChange(Number(event.target.value) || 0)}
            className="h-9 w-full rounded-[8px] border border-ink/[0.07] bg-ink/[0.03] px-2.5 text-[13.5px] text-[var(--beat-text-1)] outline-none focus:border-ink/20 disabled:opacity-40"
          />
        ) : (
          <input
            value={String(current)}
            disabled={isLocked}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.label}
            className="h-9 w-full rounded-[8px] border border-ink/[0.07] bg-ink/[0.03] px-2.5 text-[13.5px] text-[var(--beat-text-1)] outline-none placeholder:text-ink/25 focus:border-ink/20 disabled:opacity-40"
          />
        )}
      </HintTip>
    </div>
  );
}

/**
 * Music style panel.
 *
 * Reworked from a flat 18-field grid: parameters are split into four tabs so the
 * composer keeps a predictable height, the header always shows the effective style
 * in one line, and the lyric examples sit at the bottom where the eye lands after
 * picking a style.
 *
 * Only meaningful in music mode — the parent gates it, and the component itself
 * also refuses to render without a style value so it can never leak into image or
 * video mode.
 */
export function StudioMusicPanel({
  value,
  onChange,
  onInsertLyricsTemplate,
  onInsertLyricsExample,
  disabled = false,
  active = true,
}: {
  value: MusicStyleValue;
  onChange: (next: MusicStyleValue) => void;
  onInsertLyricsTemplate: () => void;
  onInsertLyricsExample?: (example: MusicLyricsExample) => void;
  disabled?: boolean;
  /** Guard: the composer passes media === 'audio'; anything else renders nothing. */
  active?: boolean;
}) {
  const [group, setGroup] = useState<MusicStyleGroup>('core');
  const [showExamples, setShowExamples] = useState(false);

  if (!active) return null;

  const summary = summarizeMusicStyle(value);
  const recipeActive = isRecipeActive(value);
  const fields = MUSIC_STYLE_FIELDS.filter((field) => field.group === group);

  const setField = (key: string, next: string | number) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="mb-2 overflow-hidden rounded-[14px] border border-ink/[0.09] bg-gradient-to-b from-ink/[0.045] to-ink/[0.015]">
      {/* Header: what this is, and what it currently produces. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink/[0.07] px-3 py-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--beat-accent)]/15 text-[var(--beat-accent)]">
          <Music2 className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13.5px] font-medium leading-none text-[var(--beat-text-1)]">
            {m['studio.music.panelTitle']()}
          </span>
          <span className="mt-1 truncate text-[13px] leading-none text-[var(--beat-text-3)]">
            {summary || m['studio.music.summaryEmpty']()}
          </span>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onInsertLyricsTemplate}
          className="flex items-center gap-1 rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2.5 py-1 text-[13px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
        >
          <FileText className="size-3.5" />
          {m['studio.music.insertLyricsTemplate']()}
        </button>
        <button
          type="button"
          onClick={() => setShowExamples((current) => !current)}
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] transition',
            showExamples
              ? 'border-[var(--beat-accent)]/45 bg-[var(--beat-accent)]/12 text-white'
              : 'border-ink/[0.1] bg-ink/[0.04] text-[var(--beat-text-2)] hover:border-ink/25 hover:text-ink'
          )}
        >
          <Sparkles className="size-3.5" />
          {m['studio.music.examples']()}
          <ChevronDown
            className={cn('size-4 transition-transform', showExamples && 'rotate-180')}
          />
        </button>
      </div>

      {/* Tabs: four groups instead of a binary expand, so height stays stable. */}
      <div className="flex items-center gap-1 border-b border-ink/[0.07] px-3 py-2">
        {GROUPS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setGroup(item)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[13px] transition',
              group === item
                ? 'bg-ink/[0.1] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'
                : 'text-[var(--beat-text-3)] hover:bg-ink/[0.05] hover:text-[var(--beat-text-1)]'
            )}
          >
            {MUSIC_STYLE_GROUP_LABELS[item]}
          </button>
        ))}
        <span className="ml-auto hidden truncate pl-2 text-[14px] text-[var(--beat-text-3)] sm:block">
          {MUSIC_GROUP_BLURB[group]}
        </span>
      </div>

      {/* Recipe active: the node overwrites these fields server-side. */}
      {recipeActive ? (
        <div className="mx-3 mb-1 flex items-start gap-1.5 rounded-[9px] border border-[var(--beat-accent)]/30 bg-[var(--beat-accent)]/[0.08] px-2.5 py-2">
          <AlertTriangle className="mt-px size-4 shrink-0 text-[var(--beat-accent)]" />
          <span className="text-[14px] leading-[15px] text-[var(--beat-text-2)]">
            {m['studio.music.recipeNotice']()}
          </span>
        </div>
      ) : null}

      {/* Active group's fields. */}
      <div className="grid grid-cols-1 gap-x-2 gap-y-2 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <FieldCell
            key={field.key}
            field={field}
            current={value[field.key] ?? field.default}
            onChange={(next) => setField(field.key, next)}
            disabled={disabled}
            locked={isFieldLockedByRecipe(value, field.key)}
          />
        ))}
      </div>

      {/* Lyric examples. Picking one fills both the lyric box and the matching style. */}
      {showExamples ? (
        <div className="border-t border-ink/[0.07] px-3 py-2.5">
          <p className="mb-2 text-[14px] text-[var(--beat-text-3)]">
            {m['studio.music.examplesHint']()}
          </p>
          <div className="flex flex-col gap-1.5">
            {MUSIC_LYRICS_EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                disabled={disabled}
                onClick={() => onInsertLyricsExample?.(example)}
                className="group flex items-center gap-2 rounded-[10px] border border-ink/[0.08] bg-ink/[0.02] px-2.5 py-2 text-left transition hover:border-[var(--beat-accent)]/40 hover:bg-ink/[0.05] disabled:opacity-40"
              >
                <span className="shrink-0 rounded-full bg-ink/[0.07] px-2 py-0.5 text-[14px] text-[var(--beat-text-1)]">
                  {example.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--beat-text-3)]">
                  {example.text.replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 46)}
                </span>
                <span className="shrink-0 text-[14px] text-[var(--beat-accent)] opacity-0 transition group-hover:opacity-100">
                  {m['studio.music.useExample']()}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

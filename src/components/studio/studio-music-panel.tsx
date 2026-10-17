import { ChevronDown, Music2, Wand2 } from 'lucide-react';
import { useState } from 'react';

import { HintTip } from '@/components/app/hint-tip';
import { WorkspaceSelect } from '@/components/app/workspace-select';
import {
  MUSIC_STYLE_FIELDS,
  MUSIC_STYLE_GROUP_LABELS,
  type MusicStyleField,
  type MusicStyleGroup,
} from '@/core/effects/music-style';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

type MusicStyleValue = Record<string, string | number>;

const CORE_GROUPS: MusicStyleGroup[] = ['core'];
const ALL_GROUPS: MusicStyleGroup[] = ['core', 'voice', 'arrange', 'extra'];

/** One labelled cell. The label sits above the control: a bare value alone says nothing. */
function FieldCell({
  field,
  current,
  onChange,
}: {
  field: MusicStyleField;
  current: string | number;
  onChange: (next: string | number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-[10px] leading-none text-[var(--beat-text-3)]">
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
            onChange={(event) => onChange(Number(event.target.value) || 0)}
            className="h-8 w-full rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-2.5 text-[12px] text-[var(--beat-text-1)] outline-none focus:border-white/20"
          />
        ) : (
          <input
            value={String(current)}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.label}
            className="h-8 w-full rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-2.5 text-[12px] text-[var(--beat-text-1)] outline-none placeholder:text-white/25 focus:border-white/20"
          />
        )}
      </HintTip>
    </div>
  );
}

/**
 * Music style parameter panel.
 *
 * Only rendered in music mode. The style/language/mood group is open by default;
 * voice, arrangement and advanced are collapsed — laying out all 18 parameters at
 * once would push the prompt box off screen.
 */
export function StudioMusicPanel({
  value,
  onChange,
  onInsertLyricsTemplate,
  disabled = false,
}: {
  value: MusicStyleValue;
  onChange: (next: MusicStyleValue) => void;
  onInsertLyricsTemplate: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = expanded ? ALL_GROUPS : CORE_GROUPS;

  const setField = (key: string, next: string | number) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="mb-2 rounded-[12px] border border-white/[0.08] bg-black/30 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Music2 className="size-3.5 shrink-0 text-[var(--beat-text-2)]" />
          <HintTip
            label={m['studio.music.panelLabel']()}
            description={m['studio.music.panelHint']()}
            side="bottom"
            className="min-w-0"
          >
            <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-[var(--beat-text-2)]">
              {m['studio.music.panelLabel']()}
            </span>
          </HintTip>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onInsertLyricsTemplate}
            disabled={disabled}
            className="flex items-center gap-1 rounded-full border border-white/[0.09] bg-white/[0.035] px-2 py-1 text-[10.5px] text-[var(--beat-text-2)] transition hover:border-white/20 hover:text-white disabled:opacity-40"
          >
            <Wand2 className="size-3" />
            {m['studio.music.insertLyricsTemplate']()}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="flex items-center gap-1 rounded-full border border-white/[0.09] bg-white/[0.035] px-2 py-1 text-[10.5px] text-[var(--beat-text-2)] transition hover:border-white/20 hover:text-white"
          >
            {expanded
              ? m['studio.music.lessParams']()
              : m['studio.music.moreParams']()}
            <ChevronDown
              className={cn('size-3 transition-transform', expanded && 'rotate-180')}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-1.5">
            {expanded ? (
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--beat-text-3)]">
                {MUSIC_STYLE_GROUP_LABELS[group]}
              </span>
            ) : null}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {MUSIC_STYLE_FIELDS.filter((field) => field.group === group).map(
                (field) => (
                  <FieldCell
                    key={field.key}
                    field={field}
                    current={value[field.key] ?? field.default}
                    onChange={(next) => setField(field.key, next)}
                  />
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

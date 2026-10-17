import { Clapperboard, Film, Image as ImageIcon, Plus, Scissors, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { HintTip } from '@/components/app/hint-tip';
import { WorkspaceSelect } from '@/components/app/workspace-select';
import {
  COMMON_LORAS,
  DIRECTOR_FIELDS,
  DIRECTOR_GROUP_LABELS,
  LORA_SLOT_COUNT,
  splitScriptIntoShots,
  type DirectorLora,
  type DirectorSegment,
  type DirectorSettings,
} from '@/core/effects/aicg3d-director';
import { ImageHoverPreview } from '@/components/app/image-hover-preview';
import {
  ASSET_KIND_LABELS,
  SCRIPT_TEMPLATE,
  parseScriptDocument,
  type ScriptAsset,
} from '@/core/effects/script-document';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

type DirectorGlobal = Record<string, string | number | boolean>;

const GROUPS = ['output', 'motion', 'sampling', 'memory', 'audio'] as const;

/**
 * AICG3D director console.
 *
 * The three-segment templates used to write one prompt into every segment, which made
 * segmentation pointless. This surfaces global params, per-shot prompt/seconds/reference
 *
 * images, and the nine LoRA slots on H3Loader. Shot references come either from existing
 * assets or from generating one first; generation runs through the normal studio flow.
 */
export function StudioDirectorConsole({
  settings,
  onChange,
  disabled = false,
  assetUrls = [],
  onRequestGenerateImage,
  onGenerateAssetImage,
  onUploadAssetImage,
  onImportAssetToShots,
}: {
  settings: DirectorSettings;
  onChange: (next: DirectorSettings) => void;
  disabled?: boolean;
  /** Existing project images available as shot references. */
  assetUrls?: string[];
  /** Called when the user wants to generate a reference for a shot. */
  onRequestGenerateImage?: (segmentIndex: number, prompt: string) => void;
  /** Generate a reference image for an asset. */
  onGenerateAssetImage?: (assetId: string, prompt: string) => void;
  /** Upload a reference image for an asset. */
  onUploadAssetImage?: (assetId: string, file: File) => void;
  /** Attach an asset image to a shot. */
  onImportAssetToShots?: (asset: ScriptAsset) => void;
}) {
  const [tab, setTab] = useState<'shots' | 'assets' | 'global' | 'lora'>('shots');
  const [scriptOpen, setScriptOpen] = useState(false);
  const [script, setScript] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const assetFileRef = useRef<HTMLInputElement | null>(null);
  const [uploadAsset, setUploadAsset] = useState<ScriptAsset | null>(null);

  const segments = settings.segments;
  const setGlobal = (key: string, value: string | number | boolean) =>
    onChange({ ...settings, global: { ...settings.global, [key]: value } });

  const updateSegment = (index: number, patch: Partial<DirectorSegment>) =>
    onChange({
      ...settings,
      segments: segments.map((seg, i) => (i === index ? { ...seg, ...patch } : seg)),
    });

  const addSegment = () =>
    onChange({
      ...settings,
      segments: [...segments, { prompt: '', seconds: 4 }],
    });

  const removeSegment = (index: number) =>
    onChange({ ...settings, segments: segments.filter((_, i) => i !== index) });

  const applyScript = () => {
    const shots = splitScriptIntoShots(script);
    if (shots.length === 0) return;
    onChange({ ...settings, segments: shots });
    setScriptOpen(false);
    const doc = parseScriptDocument(script);
    if (doc.segments.length === 0 && doc.assets.length === 0) return;
    onChange({
      ...settings,
      segments: doc.segments.length > 0 ? doc.segments : settings.segments,
      assets: doc.assets,
    });
    setScriptOpen(false);
  };

  const setLora = (index: number, patch: Partial<DirectorLora>) => {
    const next = [...settings.loras];
    while (next.length <= index) next.push({ file: 'none', strength: 1 });
    next[index] = { ...next[index], ...patch };
    onChange({ ...settings, loras: next });
  };

  const buildAssetPrompt = (asset: ScriptAsset) =>
    [asset.description, asset.name].filter(Boolean).join(', ');

  const totalSeconds = segments.reduce((sum, seg) => sum + (Number(seg.seconds) || 0), 0);

  return (
    <div className="mb-2 overflow-hidden rounded-[14px] border border-ink/[0.09] bg-gradient-to-b from-ink/[0.045] to-ink/[0.015]">
      {/* Header: shot count and total length at a glance. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink/[0.07] px-3 py-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--beat-accent)]/15 text-[var(--beat-accent)]">
          <Clapperboard className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12px] font-medium leading-none text-[var(--beat-text-1)]">
            {m['studio.director.title']()}
          </span>
          <span className="mt-1 truncate text-[11px] leading-none text-[var(--beat-text-3)]">
            {segments.length > 0
              ? m['studio.director.summary']({
                  shots: segments.length,
                  seconds: Math.round(totalSeconds * 10) / 10,
                })
              : m['studio.director.summaryEmpty']()}
          </span>
          {segments.length > 0 ? (
            <span className="mt-0.5 truncate text-[10px] leading-none text-[var(--beat-text-3)]">
              {m['studio.director.stitchHint']()}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setScriptOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-40',
            scriptOpen
              ? 'border-[var(--beat-accent)]/45 bg-[var(--beat-accent)]/12 text-ink'
              : 'border-ink/[0.1] bg-ink/[0.04] text-[var(--beat-text-2)] hover:border-ink/25 hover:text-ink'
          )}
        >
          <Scissors className="size-3" />
          {m['studio.director.importScript']()}
        </button>
      </div>

      {/* Script import. */}
      {scriptOpen ? (
        <div className="border-b border-ink/[0.07] px-3 py-2.5">
          <p className="mb-2 text-[10.5px] text-[var(--beat-text-3)]">
            {m['studio.director.scriptHint']()}
          </p>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={m['studio.director.scriptPlaceholder']()}
            className="mb-2 h-32 w-full resize-none rounded-[10px] border border-ink/[0.08] bg-ink/[0.03] px-2.5 py-2 text-[12px] leading-5 text-[var(--beat-text-1)] outline-none placeholder:text-ink/25 focus:border-ink/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || !script.trim()}
              onClick={applyScript}
              className="rounded-full bg-[var(--beat-accent)] px-3 py-1 text-[11px] font-medium text-white transition disabled:opacity-40"
            >
              {m['studio.director.splitButton']()}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2.5 py-1 text-[11px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
            >
              <Upload className="size-3" />
              {m['studio.director.uploadScript']()}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setScript(SCRIPT_TEMPLATE)}
              className="rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2.5 py-1 text-[11px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
            >
              {m['studio.director.useTemplate']()}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.fountain,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => setScript(text));
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>
      ) : null}

      {/* Three tabs: shots / parameters / LoRA. */}
      <div className="flex items-center gap-1 border-b border-ink/[0.07] px-3 py-2">
        {(
          [
            ['shots', m['studio.director.tabShots'](), `${segments.length}`],
            ['assets', m['studio.director.tabAssets'](), `${settings.assets?.length ?? 0}`],
            ['global', m['studio.director.tabGlobal'](), ''],
            ['lora', m['studio.director.tabLora'](), ''],
          ] as const
        ).map(([key, label, badge]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition',
              tab === key
                ? 'bg-ink/[0.1] text-ink shadow-[inset_0_0_0_1px_rgba(127,127,127,0.2)]'
                : 'text-[var(--beat-text-3)] hover:bg-ink/[0.05] hover:text-[var(--beat-text-1)]'
            )}
          >
            {label}
            {badge ? (
              <span className="rounded-full bg-ink/[0.12] px-1 text-[10px] tabular-nums">{badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'shots' ? (
        <div className="flex flex-col gap-2 px-3 py-2.5">
          {segments.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-[var(--beat-text-3)]">
              {m['studio.director.noShots']()}
            </p>
          ) : (
            segments.map((seg, index) => (
              <div key={index} className="rounded-[10px] border border-ink/[0.07] bg-ink/[0.02] p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded-full bg-ink/[0.1] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--beat-text-1)]">
                    {m['studio.director.shotLabel']({ index: index + 1 })}
                  </span>
                  <label className="ml-auto flex items-center gap-1">
                    <input
                      type="number"
                      value={seg.seconds}
                      min={0.2}
                      max={30}
                      step={0.5}
                      disabled={disabled}
                      onChange={(e) =>
                        updateSegment(index, { seconds: Number(e.target.value) || 4 })
                      }
                      className="w-14 rounded-[6px] border border-ink/[0.07] bg-ink/[0.03] px-1.5 py-1 text-right text-[11px] text-[var(--beat-text-1)] outline-none focus:border-ink/20"
                    />
                    <span className="text-[10px] text-[var(--beat-text-3)]">
                      {m['studio.director.seconds']()}
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeSegment(index)}
                    aria-label={m['studio.director.removeShot']()}
                    className="grid size-6 place-items-center rounded-full text-[var(--beat-text-3)] transition hover:bg-ink/[0.08] hover:text-ink disabled:opacity-40"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                <textarea
                  value={seg.prompt}
                  disabled={disabled}
                  onChange={(e) => updateSegment(index, { prompt: e.target.value })}
                  placeholder={m['studio.director.shotPlaceholder']()}
                  className="mb-1.5 h-16 w-full resize-none rounded-[8px] border border-ink/[0.07] bg-ink/[0.03] px-2 py-1.5 text-[12px] leading-5 text-[var(--beat-text-1)] outline-none placeholder:text-ink/25 focus:border-ink/20"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Consistency: the same character/scene image in every shot it appears in. */}
                  {settings.assets.length > 0 ? (
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      {settings.assets.map((asset) => {
                        const on = (seg.assetIds ?? []).includes(asset.id);
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              const ids = seg.assetIds ?? [];
                              updateSegment(index, {
                                assetIds: on
                                  ? ids.filter((id) => id !== asset.id)
                                  : [...ids, asset.id],
                              });
                            }}
                            title={asset.description || asset.name}
                            className={cn(
                              'max-w-[110px] truncate rounded-full border px-1.5 py-0.5 text-[10px] transition disabled:opacity-40',
                              on
                                ? 'border-[var(--beat-accent)]/50 bg-[var(--beat-accent)]/15 text-[var(--beat-accent)]'
                                : 'border-ink/[0.1] bg-ink/[0.03] text-[var(--beat-text-3)] hover:text-ink'
                            )}
                          >
                            {ASSET_KIND_LABELS[asset.kind]?.slice(0, 1)} · {asset.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {(seg.imageUrls ?? []).map((url) => (
                    <ImageHoverPreview key={url} src={url} previewWidth={280} previewHeight={280}>
                    <span
                      key={url}
                      className="relative size-8 overflow-hidden rounded-[6px] border border-ink/[0.1]"
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          updateSegment(index, {
                            imageUrls: (seg.imageUrls ?? []).filter((u) => u !== url),
                          })
                        }
                        aria-label={m['studio.director.removeImage']()}
                        className="absolute inset-0 grid place-items-center bg-black/55 text-[10px] text-white opacity-0 transition hover:opacity-100"
                      >
                        ×
                      </button>
                    </span>
                    </ImageHoverPreview>
                  ))}
                  {assetUrls.length > 0 ? (
                    <select
                      value=""
                      disabled={disabled}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        updateSegment(index, {
                          imageUrls: [...(seg.imageUrls ?? []), e.target.value],
                        });
                        e.currentTarget.value = '';
                      }}
                      className="h-8 max-w-[150px] rounded-[6px] border border-ink/[0.07] bg-ink/[0.03] px-1.5 text-[11px] text-[var(--beat-text-2)] outline-none"
                    >
                      <option value="">{m['studio.director.pickAsset']()}</option>
                      {assetUrls.slice(0, 40).map((url) => (
                        <option key={url} value={url}>
                          {decodeURIComponent(url.split('/').pop() ?? url).slice(0, 22)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {onRequestGenerateImage ? (
                    <HintTip
                      label={m['studio.director.generateImage']()}
                      description={m['studio.director.generateImageHint']()}
                    >
                      <button
                        type="button"
                        disabled={disabled || !seg.prompt.trim()}
                        onClick={() => onRequestGenerateImage(index, seg.prompt)}
                        className="flex items-center gap-1 rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2 py-1 text-[10.5px] text-[var(--beat-text-2)] transition hover:border-[var(--beat-accent)]/40 hover:text-ink disabled:opacity-40"
                      >
                        <ImageIcon className="size-3" />
                        {m['studio.director.generateImage']()}
                      </button>
                    </HintTip>
                  ) : null}
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={addSegment}
            className="flex items-center justify-center gap-1 rounded-[8px] border border-dashed border-ink/[0.12] py-1.5 text-[11px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
          >
            <Plus className="size-3" />
            {m['studio.director.addShot']()}
          </button>
        </div>
      ) : null}

      {tab === 'assets' ? (
        <div className="flex flex-col gap-2 px-3 py-2.5">
          {(['character', 'scene', 'prop'] as const).map((kind) => {
            const items = settings.assets.filter((a) => a.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} className="flex flex-col gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--beat-text-3)]">
                  {ASSET_KIND_LABELS[kind]}
                </span>
                {items.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center gap-2 rounded-[10px] border border-ink/[0.07] bg-ink/[0.02] p-1.5"
                  >
                    <ImageHoverPreview src={asset.imageUrl} alt={asset.name}>
                      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[7px] border border-ink/[0.1] bg-ink/[0.05]">
                        {asset.imageUrl ? (
                          <img src={asset.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon className="size-3.5 text-[var(--beat-text-3)]" />
                        )}
                      </span>
                    </ImageHoverPreview>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[11.5px] text-[var(--beat-text-1)]">{asset.name}</span>
                      {asset.description ? (
                        <span className="truncate text-[10px] text-[var(--beat-text-3)]">{asset.description}</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onGenerateAssetImage?.(asset.id, buildAssetPrompt(asset))}
                      className="shrink-0 rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2 py-1 text-[10.5px] text-[var(--beat-text-2)] transition hover:border-[var(--beat-accent)]/40 hover:text-ink disabled:opacity-40"
                    >
                      {m['studio.director.assetGenerate']()}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setUploadAsset(asset);
                        requestAnimationFrame(() => assetFileRef.current?.click());
                      }}
                      className="shrink-0 rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2 py-1 text-[10.5px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
                    >
                      {m['studio.director.assetUpload']()}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onImportAssetToShots?.(asset)}
                      title={m['studio.director.assetImportHint']()}
                      className="shrink-0 rounded-full bg-[var(--beat-accent)]/15 px-2 py-1 text-[10.5px] text-[var(--beat-accent)] transition hover:bg-[var(--beat-accent)]/25 disabled:opacity-40"
                    >
                      {m['studio.director.assetImport']()}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
          {settings.assets.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-[var(--beat-text-3)]">
              {m['studio.director.noAssets']()}
            </p>
          ) : null}
          <input
            ref={assetFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const target = uploadAsset;
              e.currentTarget.value = '';
              setUploadAsset(null);
              if (file && target) onUploadAssetImage?.(target.id, file);
            }}
          />
        </div>
      ) : null}

      {tab === 'global' ? (
        <div className="flex flex-col gap-2 px-3 py-2.5">
          {GROUPS.map((group) => (
            <div key={group} className="flex flex-col gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--beat-text-3)]">
                {DIRECTOR_GROUP_LABELS[group]}
              </span>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {DIRECTOR_FIELDS.filter((f) => f.group === group).map((field) => {
                  const current = settings.global[field.key] ?? field.default;
                  return (
                    <div key={field.key} className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-[10px] leading-none text-[var(--beat-text-3)]">
                        {field.label}
                      </span>
                      <HintTip label={field.label} description={field.hint} className="min-w-0">
                        {field.type === 'select' && field.options ? (
                          <WorkspaceSelect
                            ariaLabel={field.label}
                            triggerClassName="w-full"
                            value={String(current)}
                            options={field.options.map((o) => ({ value: o, label: o }))}
                            onChange={(v) => setGlobal(field.key, v)}
                          />
                        ) : field.type === 'boolean' ? (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => setGlobal(field.key, current !== true)}
                            className={cn(
                              'h-8 rounded-[8px] border px-2 text-[11px] transition',
                              current === true
                                ? 'border-[var(--beat-accent)]/45 bg-[var(--beat-accent)]/12 text-ink'
                                : 'border-ink/[0.07] bg-ink/[0.03] text-[var(--beat-text-2)]'
                            )}
                          >
                            {current === true
                              ? m['studio.director.on']()
                              : m['studio.director.off']()}
                          </button>
                        ) : (
                          <input
                            type="number"
                            value={Number(current)}
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            disabled={disabled}
                            onChange={(e) => setGlobal(field.key, Number(e.target.value) || 0)}
                            className="h-8 w-full rounded-[8px] border border-ink/[0.07] bg-ink/[0.03] px-2.5 text-[12px] text-[var(--beat-text-1)] outline-none focus:border-ink/20"
                          />
                        )}
                      </HintTip>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'lora' ? (
        <div className="flex flex-col gap-1.5 px-3 py-2.5">
          <p className="mb-1 text-[10.5px] text-[var(--beat-text-3)]">
            {m['studio.director.loraHint']()}
          </p>
          {Array.from({ length: LORA_SLOT_COUNT }, (_, i) => {
            const entry = settings.loras[i] ?? { file: 'none', strength: 1 };
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10px] tabular-nums text-[var(--beat-text-3)]">
                  {m['studio.director.loraLabel']({ index: i + 1 })}
                </span>
                <div className="min-w-0 flex-1">
                  <WorkspaceSelect
                    ariaLabel={m['studio.director.loraLabel']({ index: i + 1 })}
                    triggerClassName="w-full"
                    value={entry.file}
                    options={[
                      ...COMMON_LORAS.map((f) => ({ value: f, label: f === 'none' ? 'none' : f.split('\\').pop()!.replace('.safetensors', '') })),
                      ...(COMMON_LORAS.includes(entry.file)
                        ? []
                        : [{ value: entry.file, label: entry.file }]),
                    ]}
                    onChange={(file) => setLora(i, { file })}
                  />
                </div>
                <input
                  type="number"
                  value={entry.strength}
                  min={-4}
                  max={4}
                  step={0.05}
                  disabled={disabled}
                  onChange={(e) => setLora(i, { strength: Number(e.target.value) })}
                  className="w-16 shrink-0 rounded-[6px] border border-ink/[0.07] bg-ink/[0.03] px-1.5 py-1 text-right text-[11px] text-[var(--beat-text-1)] outline-none focus:border-ink/20"
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

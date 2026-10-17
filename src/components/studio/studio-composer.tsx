import {
  ArrowUp,
  Film,
  ImageIcon,
  ImagePlus,
  Loader2,
  ScanSearch,
  Music2,
  Sparkles,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  composerCardClassName,
  composerGenerateButtonClassName,
} from '@/components/app/composer-styles';
import { AiExpandControl } from '@/components/app/ai-expand-control';
import { HintTip } from '@/components/app/hint-tip';
import { WorkspaceSelect } from '@/components/app/workspace-select';
import { StudioMusicPanel } from '@/components/studio/studio-music-panel';
import { BeatCanvasComposerParameterPicker } from '@/components/beatcanvas/beatcanvas-composer-parameter-picker';
import { normalizeComposerToken } from '@/components/beatcanvas/beatcanvas-composer-utils';
import { useCanvasComposerLabels } from '@/components/beatcanvas/use-canvas-composer-labels';
import type { CanvasGenerationCard } from '@/core/beatcanvas/canvas-types';
import {
  countPromptCharacters,
  getGenerationPromptConstraints,
  truncatePromptToMaxChars,
} from '@/core/effects/validation';
import {
  findWorkspaceModelOption,
  getWorkspaceAspectRatioOptions,
  type WorkspaceModelOption,
} from '@/core/effects/workspace-models';
import { getModelIconPathByModelId } from '@/core/workspace-lib/model-icons';
import type { StudioMedia } from '@/core/studio/studio-runtime';
import type { VideoAnalysisDepth } from '@/core/effects/video-analysis';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';

export function StudioComposer({
  draft,
  media,
  imageModels,
  videoModels,
  audioModels,
  musicStyle,
  onMusicStyleChange,
  onInsertLyricsTemplate,
  audioRefs,
  onAudioFileSelect,
  onRemoveAudio,
  isBusy,
  promptCharacterLimit,
  takeCount: _takeCount = 0,
  analysisDepth,
  analysisFileName,
  onDraftChange,
  onMediaChange,
  onAnalysisDepthChange,
  onAnalysisFileSelect,
  onClearAnalysisFile,
  onGenerate,
  referenceUrls = [],
  onRemoveReference,
  onReferenceFileSelect,
  onHeightChange,
}: {
  draft: CanvasGenerationCard;
  media: StudioMedia;
  imageModels: WorkspaceModelOption[];
  videoModels: WorkspaceModelOption[];
  audioModels: WorkspaceModelOption[];
  musicStyle?: Record<string, string | number>;
  onMusicStyleChange?: (next: Record<string, string | number>) => void;
  onInsertLyricsTemplate?: () => void;
  audioRefs?: string[];
  onAudioFileSelect?: (file: File) => void;
  onRemoveAudio?: (url: string) => void;
  isBusy: boolean;
  promptCharacterLimit: number;
  takeCount?: number;
  analysisDepth: VideoAnalysisDepth;
  analysisFileName: string | null;
  onDraftChange: (next: CanvasGenerationCard) => void;
  onMediaChange: (next: StudioMedia) => void;
  onAnalysisDepthChange: (next: VideoAnalysisDepth) => void;
  onAnalysisFileSelect: (file: File) => void;
  onClearAnalysisFile: () => void;
  onGenerate: () => void;
  referenceUrls?: string[];
  onRemoveReference?: (url: string) => void;
  onReferenceFileSelect?: (file: File) => void;
  /**
   * Reports the composer height. It floats above the content, so the results list
   * needs its real height for bottom padding — a fixed value is not enough, since
   * the composer grows noticeably when the segment panel is expanded.
   */
  onHeightChange?: (height: number) => void;
}) {
  const labels = useCanvasComposerLabels();
  const t = useTranslations('AppShell.studio.analysis');
  const analysisFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const parameterPickerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isParameterOpen, setIsParameterOpen] = useState(false);
  // Report own height so the results list can reserve space for it.
  // onHeightChange is a new function each render; pin it in a ref so the observer is not rebuilt.
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => onHeightChangeRef.current?.(el.offsetHeight);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isAnalysis = media === 'analysis';
  const models =
    media === 'audio'
      ? audioModels
      : media === 'video'
        ? videoModels
        : imageModels;
  const selectedModel =
    findWorkspaceModelOption(models, draft.modelId) ?? models[0] ?? null;
  const promptRequired = getGenerationPromptConstraints({
    modelId: isAnalysis ? 'video-analysis' : selectedModel?.id,
  }).required;
  const selectedModeOptions = selectedModel?.modeOptions ?? [];
  const selectedVariantOptions = selectedModel?.variantOptions ?? [];
  const selectedQualityOptions = selectedModel?.qualityOptions ?? [];
  const selectedDurationOptions =
    media === 'video' ? (selectedModel?.supportedDurations ?? []) : [];
  const selectedLanguageOptions = selectedModel?.supportedLanguages ?? [];
  const selectedAspectRatioOptions = useMemo(
    () =>
      getWorkspaceAspectRatioOptions({
        model: selectedModel,
        hasImageReferences: referenceUrls.length > 0,
      }),
    [referenceUrls.length, selectedModel]
  );
  const selectedOutputQualities = selectedModel?.supportedOutputQualities ?? [];
  const selectedCharacterOrientationOptions =
    selectedModel?.characterOrientationOptions ?? [];
  const selectedBackgroundSourceOptions =
    selectedModel?.backgroundSourceOptions ?? [];
  const visibleParameterSummaryTokens = [
    ...(selectedOutputQualities.length > 0
      ? [draft.outputQuality.toUpperCase()]
      : []),
    ...(selectedAspectRatioOptions.length > 0
      ? [normalizeComposerToken(draft.aspectRatio, labels)]
      : []),
    ...(selectedDurationOptions.length > 0 ? [draft.duration] : []),
    ...(selectedModeOptions.length > 1
      ? [normalizeComposerToken(draft.mode, labels)]
      : []),
    ...(selectedVariantOptions.length > 1
      ? [normalizeComposerToken(draft.variant, labels)]
      : []),
    ...(selectedQualityOptions.length > 1
      ? [normalizeComposerToken(draft.quality, labels)]
      : []),
  ];
  const promptCharacterCount = countPromptCharacters(draft.prompt);
  const primaryButtonLabel = isBusy
    ? isAnalysis
      ? t('analyzing')
      : labels.generatingLabel
    : isAnalysis
      ? t('analyze')
      : labels.generateLabel;
  const analysisModelOptions = [
    {
      value: 'standard',
      label: t('standardModel'),
      modelId: 'video-analysis-standard',
    },
    {
      value: 'deep',
      label: t('proModel'),
      modelId: 'video-analysis-pro',
    },
  ].map((option) => ({
    value: option.value,
    label: option.label,
    leading: (
      <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-white/90 ring-1 ring-black/10">
        <img
          src={getModelIconPathByModelId(option.modelId) || '/logo.png'}
          alt=""
          className="size-3 rounded-[2px]"
        />
      </span>
    ),
  }));

  const prevModelIdRef = useRef<string | null>(null);
  const prevReferenceCountRef = useRef<number>(-1);

  useEffect(() => {
    if (isAnalysis || selectedAspectRatioOptions.length === 0) {
      return;
    }
    const modelId = selectedModel?.id ?? null;
    const options = selectedAspectRatioOptions;
    const defaultRatio =
      selectedModel?.defaultAspectRatio ?? options[0];
    const fallbackRatio = options.includes(defaultRatio)
      ? defaultRatio
      : options[0];
    const referenceCount = referenceUrls.length;
    const modelSwitched =
      prevModelIdRef.current !== null && prevModelIdRef.current !== modelId;
    const referenceAdded =
      referenceCount > 0 && prevReferenceCountRef.current === 0;
    // Image edit: on model switch or first reference, default to follow reference.
    if (
      selectedModel?.requiresImageInput &&
      (modelSwitched || referenceAdded) &&
      options.includes('auto')
    ) {
      onDraftChange({ ...draft, aspectRatio: 'auto' });
      prevModelIdRef.current = modelId;
      prevReferenceCountRef.current = referenceCount;
      return;
    }
    if (modelSwitched) {
      onDraftChange({ ...draft, aspectRatio: fallbackRatio });
      prevModelIdRef.current = modelId;
      prevReferenceCountRef.current = referenceCount;
      return;
    }
    if (!options.includes(draft.aspectRatio)) {
      onDraftChange({ ...draft, aspectRatio: fallbackRatio });
    }
    prevModelIdRef.current = modelId;
    prevReferenceCountRef.current = referenceCount;
  }, [
    draft,
    isAnalysis,
    onDraftChange,
    referenceUrls.length,
    selectedAspectRatioOptions,
    selectedModel?.defaultAspectRatio,
    selectedModel?.id,
    selectedModel?.requiresImageInput,
  ]);

  return (
    <div
      ref={rootRef}
      className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#09090a] via-[#09090a]/96 to-transparent px-3 pb-3 pt-12 sm:px-6 sm:pb-5 sm:pt-14"
    >
      <div
        className={cn(
          'mx-auto w-full max-w-[1138px] p-2.5 sm:p-3.5',
          composerCardClassName
        )}
        data-beatapi-composer=""
      >
        {referenceUrls.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {referenceUrls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => onRemoveReference?.(url)}
                className="size-9 overflow-hidden rounded-[10px] border border-white/[0.1]"
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        {media === 'video' && selectedModel?.multiSegment ? (
          <div className="mb-2 rounded-[12px] border border-white/[0.08] bg-black/30 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <HintTip
                label={m['studio.hint.segments.label']()}
                description={m['studio.hint.segments.desc']()}
                side="bottom"
              >
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--beat-text-2)]">
                  {t('segmentPanelTitle')}
                </span>
              </HintTip>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={(draft.segments?.length ?? 0) >= 4}
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      segments: [
                        ...(draft.segments ?? []),
                        { prompt: '', duration: undefined },
                      ],
                    })
                  }
                  className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[11px] text-[var(--beat-text-2)] transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  {t('segmentAdd')}
                </button>
                <button
                  type="button"
                  disabled={(draft.segments?.length ?? 0) <= 1}
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      segments: (draft.segments ?? []).slice(0, -1),
                    })
                  }
                  className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[11px] text-[var(--beat-text-2)] transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  {t('segmentRemove')}
                </button>
              </div>
            </div>
            {(draft.segments ?? []).map((segment, index) => (
              <div
                key={index}
                className="mb-1.5 flex items-center gap-2 last:mb-0"
              >
                <span className="w-11 shrink-0 text-[11px] tabular-nums text-[var(--beat-text-3)]">
                  {t('segmentIndex', { index: index + 1 })}
                </span>
                <input
                  value={segment.prompt}
                  onChange={(event) => {
                    const next = [...(draft.segments ?? [])];
                    next[index] = { ...segment, prompt: event.target.value };
                    onDraftChange({ ...draft, segments: next });
                  }}
                  placeholder={t('segmentPromptPlaceholder')}
                  disabled={isBusy}
                  className="min-w-0 flex-1 rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-[var(--beat-text-1)] outline-none placeholder:text-white/30 focus:border-white/20"
                />
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={segment.duration ?? ''}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    const next = [...(draft.segments ?? [])];
                    next[index] = {
                      ...segment,
                      duration:
                        event.target.value === ''
                          ? undefined
                          : Number.isFinite(value) && value >= 1
                            ? Math.min(30, Math.round(value))
                            : undefined,
                    };
                    onDraftChange({ ...draft, segments: next });
                  }}
                  placeholder={String(
                    Math.max(
                      1,
                      Math.round(
                        (Number(draft.duration.replace('s', '')) || 5) /
                          Math.max(1, draft.segments?.length ?? 1)
                      )
                    )
                  )}
                  disabled={isBusy}
                  className="w-14 shrink-0 rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-1.5 py-1.5 text-center text-[12px] text-[var(--beat-text-1)] outline-none placeholder:text-white/30 focus:border-white/20"
                />
                <span className="w-4 shrink-0 text-[10px] text-[var(--beat-text-3)]">
                  {t('segmentSeconds')}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {media === 'audio' ? (
          <StudioMusicPanel
            value={musicStyle ?? {}}
            onChange={(next) => onMusicStyleChange?.(next)}
            onInsertLyricsTemplate={() => onInsertLyricsTemplate?.()}
            disabled={isBusy}
          />
        ) : null}

        {media === 'audio' ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => audioFileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-white/[0.13] bg-white/[0.03] px-2.5 py-1 text-[11px] text-[var(--beat-text-2)] transition hover:border-white/25 hover:text-white disabled:opacity-40"
            >
              <Music2 className="size-3.5" />
              {m['studio.music.uploadAudio']()}
            </button>
            {(audioRefs ?? []).map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => onRemoveAudio?.(url)}
                title={m['studio.music.removeAudio']()}
                className="max-w-[200px] truncate rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] text-[var(--beat-text-1)]"
              >
                {decodeURIComponent(url.split('/').pop() ?? url).slice(0, 40)}
              </button>
            ))}
            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/mpeg,audio/wav,audio/mp4,audio/flac,audio/ogg,.mp3,.wav,.m4a,.flac,.ogg"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAudioFileSelect?.(file);
                event.currentTarget.value = '';
              }}
            />
          </div>
        ) : null}
        <div className="relative">
          <button
            type="button"
            aria-label={isAnalysis ? t('uploadVideo') : labels.uploadImageLabel}
            title={isAnalysis ? t('uploadVideo') : labels.uploadImageLabel}
            onClick={() => {
              if (isAnalysis) {
                analysisFileInputRef.current?.click();
              } else {
                imageFileInputRef.current?.click();
              }
            }}
            className="absolute left-0 top-0 z-10 flex size-9 rotate-[-5deg] items-center justify-center rounded-[10px] border border-dashed border-white/[0.13] bg-white/[0.03] text-[var(--beat-text-2)] shadow-[0_8px_20px_rgba(0,0,0,0.24)] transition hover:border-white/25 hover:bg-white/[0.06]"
          >
            {isAnalysis ? (
              <Video className="size-3.5" />
            ) : (
              <ImagePlus className="size-3.5" />
            )}
          </button>
          <input
            ref={analysisFileInputRef}
            type="file"
            accept=".mp4,.mov,video/mp4,video/quicktime"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onAnalysisFileSelect(file);
              event.currentTarget.value = '';
            }}
          />
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onReferenceFileSelect?.(file);
              event.currentTarget.value = '';
            }}
          />
          <div className="absolute right-1.5 top-1.5 z-10">
            <HintTip
              label={m['studio.hint.expand.label']()}
              description={m['studio.hint.expand.desc']()}
            >
              <AiExpandControl
                prompt={draft.prompt}
                mediaType={isAnalysis ? 'image' : media === 'video' ? 'video' : 'image'}
                isBusy={isBusy}
                onExpanded={(expanded) =>
                  onDraftChange({
                    ...draft,
                    prompt: truncatePromptToMaxChars(
                      expanded,
                      promptCharacterLimit
                    ),
                  })
                }
              />
            </HintTip>
          </div>
          <textarea
            value={draft.prompt}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                prompt: truncatePromptToMaxChars(
                  event.target.value,
                  promptCharacterLimit
                ),
              })
            }
            placeholder={
              isAnalysis
                ? t('promptPlaceholder')
                : media === 'audio'
                ? m['studio.audioPromptPlaceholder']()
                : media === 'video'
                ? labels.videoPromptPlaceholder
                : labels.imagePromptPlaceholder
            }
            disabled={isBusy}
            className="h-[80px] min-h-[80px] w-full resize-none bg-transparent py-2 pl-[52px] pr-3 text-[14px] leading-6 text-[var(--beat-text-1)] outline-none placeholder:text-white/35 sm:h-[92px] sm:min-h-[92px] sm:pl-[56px] sm:pr-16 sm:text-[15px]"
          />
        </div>

        <div className="mt-1.5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <WorkspaceSelect
              ariaLabel="Media type"
               hint={{
                 label: m['studio.hint.media.label'](),
                 description: m['studio.hint.media.desc'](),
               }}
              triggerClassName="min-w-[96px]"
              value={media}
              options={[
                {
                  value: 'image',
                  label: labels.imageModeLabel,
                  leading: (
                    <ImageIcon className="size-3.5 shrink-0 text-[var(--beat-text-2)]" />
                  ),
                },
                {
                  value: 'video',
                  label: labels.videoModeLabel,
                  leading: (
                    <Film className="size-3.5 shrink-0 text-[var(--beat-text-2)]" />
                  ),
                },
                {
                  value: 'audio',
                  label: m['studio.mediaMusic'](),
                  leading: (
                    <Music2 className="size-3.5 shrink-0 text-[var(--beat-text-2)]" />
                  ),
                },
                {
                  value: 'analysis',
                  label: t('modeLabel'),
                  leading: (
                    <ScanSearch className="size-3.5 shrink-0 text-[var(--beat-text-2)]" />
                  ),
                },
              ]}
              onChange={(type) =>
                onMediaChange(
                  type === 'analysis'
                    ? 'analysis'
                    : type === 'video'
                      ? 'video'
                      : type === 'audio'
                        ? 'audio'
                        : 'image'
                )
              }
            />

            {isAnalysis ? (
              <>
                <WorkspaceSelect
                  ariaLabel={t('modelLabel')}
                  triggerClassName="w-fit max-w-full"
                  value={analysisDepth}
                  options={analysisModelOptions}
                  onChange={(value) =>
                    onAnalysisDepthChange(value === 'deep' ? 'deep' : 'standard')
                  }
                />
                {analysisFileName ? (
                  <button
                    type="button"
                    onClick={onClearAnalysisFile}
                    className="max-w-[220px] truncate rounded-full border border-white/[0.09] bg-white/[0.035] px-2.5 py-1 text-[11px] text-[var(--beat-text-2)]"
                    title={t('removeVideo')}
                  >
                    {analysisFileName}
                  </button>
                ) : null}
              </>
            ) : (
            <WorkspaceSelect
              ariaLabel="Model"
              hint={{
                label: m['studio.hint.model.label'](),
                description: m['studio.hint.model.desc'](),
              }}
              triggerClassName="w-fit max-w-full"
              value={selectedModel?.id || ''}
              options={models.map((model) => ({
                value: model.id,
                label: model.name,
                description: model.description,
                group: model.isLocalFree === true ? undefined : 'paid',
                groupLabel: labels.paidModelsLabel,
                leading: (
                  <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-white/90 ring-1 ring-black/10">
                    <img
                      src={getModelIconPathByModelId(model.id) || '/logo.png'}
                      alt=""
                      className="size-3 rounded-[2px]"
                    />
                  </span>
                ),
              }))}
              onChange={(modelId) => onDraftChange({ ...draft, modelId })}
              leadingIcon={
                <Sparkles className="size-3.5 shrink-0 text-[var(--beat-text-2)]" />
              }
            />
            )}

            {!isAnalysis && visibleParameterSummaryTokens.length > 0 ? (
              <BeatCanvasComposerParameterPicker
                activeDraftCard={draft}
                containerRef={parameterPickerRef}
                isDraftBusy={isBusy}
                isOpen={isParameterOpen}
                labels={labels}
                onDraftAspectRatioChange={(_draftId, aspectRatio) =>
                  onDraftChange({ ...draft, aspectRatio })
                }
                onDraftBackgroundSourceChange={(_draftId, backgroundSource) =>
                  onDraftChange({ ...draft, backgroundSource })
                }
                onDraftCharacterOrientationChange={(
                  _draftId,
                  characterOrientation
                ) => onDraftChange({ ...draft, characterOrientation })}
                onDraftDurationChange={(_draftId, duration) =>
                  onDraftChange({ ...draft, duration })
                }
                onDraftLanguageChange={(_draftId, language) =>
                  onDraftChange({ ...draft, language })
                }
                onDraftModeChange={(_draftId, mode) =>
                  onDraftChange({ ...draft, mode })
                }
                onDraftOutputQualityChange={(_draftId, outputQuality) =>
                  onDraftChange({ ...draft, outputQuality })
                }
                onDraftCustomResolutionChange={(_draftId, width, height) =>
                  onDraftChange({
                    ...draft,
                    customOutputQuality: width !== null && height !== null,
                    customWidth: width,
                    customHeight: height,
                  })
                }
                onDraftQualityChange={(_draftId, quality) =>
                  onDraftChange({ ...draft, quality })
                }
                onDraftVariantChange={(_draftId, variant) =>
                  onDraftChange({ ...draft, variant })
                }
                onOpenChange={setIsParameterOpen}
                parameterSummaryLabel={labels.parameterLabel}
                selectedAspectRatioOptions={selectedAspectRatioOptions}
                selectedBackgroundSourceOptions={
                  selectedBackgroundSourceOptions
                }
                selectedCharacterOrientationOptions={
                  selectedCharacterOrientationOptions
                }
                selectedDurationOptions={selectedDurationOptions}
                selectedLanguageOptions={selectedLanguageOptions}
                selectedModeOptions={selectedModeOptions}
                selectedOutputQualities={selectedOutputQualities}
                selectedQualityOptions={selectedQualityOptions}
                selectedVariantOptions={selectedVariantOptions}
                visibleParameterSummaryTokens={visibleParameterSummaryTokens}
              />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <span
              className={cn(
                'text-[10px] font-medium tabular-nums',
                promptCharacterCount >= promptCharacterLimit
                  ? 'text-[var(--beatcanvas-warning)]'
                  : 'text-[var(--beat-text-3)]'
              )}
            >
              {promptCharacterCount}/{promptCharacterLimit}
            </span>
            <HintTip
              label={m['studio.hint.generate.label']()}
              description={m['studio.hint.generate.desc']()}
              side="top"
            >
              <button
                type="button"
                onClick={onGenerate}
                disabled={
                  isBusy ||
                  (promptRequired && !draft.prompt.trim()) ||
                  (selectedModel?.requiresImageInput && referenceUrls.length === 0) ||
                  (isAnalysis ? !analysisFileName : !selectedModel)
                }
                className={cn(
                  composerGenerateButtonClassName,
                  'active:translate-y-px'
                )}
                aria-label={primaryButtonLabel}
              >
                {isBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
              </button>
            </HintTip>
          </div>
        </div>
      </div>
    </div>
  );
}

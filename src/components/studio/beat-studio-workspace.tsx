import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { StudioComposer } from '@/components/studio/studio-composer';
import { StudioGenerationFeed } from '@/components/studio/studio-generation-feed';
import { StudioStartHere } from '@/components/studio/studio-start-here';
import type { CanvasCardMediaType } from '@/core/beatcanvas/canvas-types';
import { resolveWmTaskId } from '@/core/effects/client-api';
import { resolveOutputMedia } from '@/core/effects/output-media';
import {
  getGenerationPromptConstraints,
  getGenerationPromptMaxChars,
} from '@/core/effects/validation';
import {
  resolveVideoAnalysisText,
  VIDEO_ANALYSIS_MODEL_ID,
  type VideoAnalysisDepth,
} from '@/core/effects/video-analysis';
import {
  findWorkspaceModelOption,
  getDefaultSelectableWorkspaceModel,
} from '@/core/effects/workspace-models';
import {
  applyStudioDraftModel,
  applyStudioHistoryItem,
  createStudioDraftCard,
} from '@/core/studio/studio-draft';
import {
  getStudioModels,
  type StudioMedia,
} from '@/core/studio/studio-runtime';
import {
  fetchProjectGenerations,
} from '@/core/workspace-lib/app/workspace-client-api';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import { parseLocalProjectAssetUrl } from '@/core/projects/local-project-asset-url';
import { GENERATION_REQUEST_VERSION } from '@/core/commands/generation-contract';
import { precheckEffect, generateEffect } from '@/core/effects/client-api';
import {
  MUSIC_LYRICS_TEMPLATE,
  getDefaultMusicStyle,
  pickChangedMusicStyle,
} from '@/core/effects/music-style';
import { fetchRecentAssets } from '@/core/workspace-lib/app/workspace-client-api';
import { getEffectsMetadata } from '@/core/effects/client-api';
import { buildDraftModelParameters } from '@/core/effects/model-parameters';
import { invalidateWorkspaceAfterGeneration } from '@/core/workspace-lib/app/workspace-query-invalidation';
import { projectGenerationsKeys } from '@/core/workspace-lib/app/workspace-query-keys';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';

type GenerationResponse = {
  status?: 'pending' | 'processing' | 'succeeded' | 'failed';
  wmTaskId?: string;
  output?: unknown;
  error?: string;
  uploadIntentToken?: string;
};

const wait = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

async function waitForGeneration({
  wmTaskId,
}: {
  wmTaskId: string;
}) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (document.visibilityState === 'hidden') {
      await wait(2500);
      attempt -= 1;
      continue;
    }
    const result = await apiJsonGet<GenerationResponse>(
      `/api/effects/status?wmTaskId=${encodeURIComponent(wmTaskId)}`
    );
    if (result.status === 'succeeded') return result.output;
    if (result.status === 'failed') {
      throw new Error(result.error || 'Generation failed');
    }
    await wait(2500);
  }
  throw new Error(
    'Generation is still processing. You can find it in History.'
  );
}

export function BeatStudioWorkspace({
  projectId,
  initialTarget,
  initialModelId,
  initialPrompt,
}: {
  projectId: string;
  initialTarget: string | null;
  initialModelId: string | null;
  initialPrompt: string | null;
}) {
  const queryClient = useQueryClient();
  const initialMedia: StudioMedia =
    initialTarget === 'analysis'
      ? 'analysis'
      : initialTarget === 'audio'
        ? 'audio'
        : initialTarget === 'video'
        ? 'video'
        : 'image';
  const imageModels = useMemo(() => getStudioModels('image'), []);
  const videoModels = useMemo(() => getStudioModels('video'), []);
  const audioModels = useMemo(() => getStudioModels('audio'), []);
  const [draft, setDraft] = useState(() => {
    const draftMedia: CanvasCardMediaType =
      initialMedia === 'audio'
        ? 'audio'
        : initialMedia === 'video'
          ? 'video'
          : 'image';
    const models =
      draftMedia === 'audio'
        ? audioModels
        : draftMedia === 'video'
          ? videoModels
          : imageModels;
    const model =
      findWorkspaceModelOption(models, initialModelId) ??
      getDefaultSelectableWorkspaceModel(
        draftMedia === 'video' ? 'ai-video' : 'ai-image'
      );
    return createStudioDraftCard({
      type: draftMedia,
      model,
      prompt: initialPrompt || '',
    });
  });
  const [media, setMedia] = useState<StudioMedia>(initialMedia);
  const [analysisDepth, setAnalysisDepth] =
    useState<VideoAnalysisDepth>('standard');
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  // The composer floats; the results list reserves its real height (value below is a first-frame fallback).
  const [composerHeight, setComposerHeight] = useState(0);
  const [musicStyle, setMusicStyle] = useState<Record<string, string | number>>(
    () => getDefaultMusicStyle()
  );
  const [audioRefs, setAudioRefs] = useState<string[]>([]);
  // Tracks whether the current prompt came from a lyric template/example, so
  // switching away from music can clear it instead of leaving it behind.
  const lyricsAutoInsertedRef = useRef(false);
  const models =
    draft.type === 'audio'
      ? audioModels
      : draft.type === 'video'
        ? videoModels
        : imageModels;
  const selectedModel =
    findWorkspaceModelOption(models, draft.modelId) ?? models[0] ?? null;

  const generationsQuery = useQuery({
    queryKey: projectGenerationsKeys.list(projectId),
    queryFn: () => fetchProjectGenerations(projectId),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) => item.status === 'pending' || item.status === 'processing'
      )
        ? 2500
        : false,
  });
  const feedItems = (generationsQuery.data?.items ?? []).filter(
    (item) => item.status !== 'failed'
  );

  useEffect(() => {
    if (!selectedModel || selectedModel.id === draft.modelId) return;
    setDraft((current) =>
      applyStudioDraftModel({ draft: current, model: selectedModel })
    );
  }, [draft.modelId, selectedModel]);

  const generation = useMutation({
    mutationFn: async () => {
      const isAnalysis = media === 'analysis';
      if (!isAnalysis && !selectedModel) {
        throw new Error('No model is available for this media type.');
      }
      const promptConstraints = getGenerationPromptConstraints({
        modelId: isAnalysis ? VIDEO_ANALYSIS_MODEL_ID : selectedModel?.id,
      });
      if (promptConstraints.required && !draft.prompt.trim()) {
        throw new Error('Describe what you want to create first.');
      }
      if (selectedModel?.requiresImageInput && referenceUrls.length === 0) {
        throw new Error(`${selectedModel.name} requires at least one image.`);
      }
      if (isAnalysis && !analysisFile) {
        throw new Error('Add an MP4 or MOV video to analyze.');
      }
      const initialInput = isAnalysis
        ? {
            prompt: draft.prompt.trim(),
            analysis_depth: analysisDepth,
          }
        : {
            prompt: draft.prompt.trim(),
            ...buildDraftModelParameters(draft, (await getEffectsMetadata([selectedModel!.id])).data.effects?.[selectedModel!.id]?.inputSchema),
          };
      const assets = referenceUrls.length ? await fetchRecentAssets(projectId) : null;
      // Music: style params key straight onto the style node; a cover also needs its source song as an audio reference.
      const musicParameters =
        !isAnalysis && draft.type === 'audio'
          ? { style: pickChangedMusicStyle(musicStyle) }
          : null;
      const musicAudioRefs =
        !isAnalysis && draft.type === 'audio' ? audioRefs : [];
      const allReferenceUrls = [...new Set([...referenceUrls, ...musicAudioRefs])];

      const references = allReferenceUrls.map((url) => {
        const local = parseLocalProjectAssetUrl(url);
        const asset = [...(assets?.images ?? []), ...(assets?.videos ?? []), ...(assets?.audios ?? [])]
          .find((item) => item.publicUrl === url ||
            (item.metadata as { providerUrl?: string } | null)?.providerUrl === url);
        const assetId = local?.assetId ?? asset?.id;
        if (!assetId) throw new Error('Reference media must belong to this project. Import it again.');
        return { assetId, role: 'reference' as const };
      });
      if (isAnalysis) {
        const asset = await uploadLocalProjectAsset({ projectId, file: analysisFile! });
        references.push({ assetId: asset.id, role: 'reference' });
      }
      const request = {
        version: GENERATION_REQUEST_VERSION,
        projectId,
        mode: isAnalysis ? 'analysis' : draft.type,
        modelId: isAnalysis ? VIDEO_ANALYSIS_MODEL_ID : selectedModel!.id,
        prompt: draft.prompt,
        references,
        parameters: musicParameters
          ? { ...initialInput, ...musicParameters }
          : initialInput,
      };
      const precheck = await precheckEffect({ generation: request });
      if (!precheck.ok) throw new Error(precheck.data.error || 'Generation validation failed.');
      const response = await generateEffect({
        generation: request, generationIntentToken: precheck.data.uploadIntentToken,
      });
      if (!response.ok) throw new Error(response.data.error || 'Generation failed.');
      const created = response.data;
      if (created.status === 'failed') {
        throw new Error(created.error || 'Generation failed');
      }
      await invalidateWorkspaceAfterGeneration(queryClient);
      const wmTaskId = resolveWmTaskId(created);
      let output = created.output;
      if (wmTaskId && created.status !== 'succeeded') {
        output = await waitForGeneration({
          wmTaskId,
        });
      }
      if (isAnalysis) {
        if (!resolveVideoAnalysisText(output)) {
          throw new Error('Analysis completed without text output.');
        }
      } else if (!resolveOutputMedia(output).resultUrl) {
        throw new Error('Generation completed without a media URL.');
      }
    },
    onSuccess: () => {
      setError('');
      void invalidateWorkspaceAfterGeneration(queryClient);
    },
    onError: (generationError: Error) => {
      setError(generationError.message);
      void invalidateWorkspaceAfterGeneration(queryClient);
    },
  });

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--beat-bg)] text-[var(--beat-text-1)]">
      <div className="pointer-events-none absolute inset-0 bg-[image:var(--beat-wash)]" />
      <div className="pointer-events-none absolute inset-x-[8%] top-0 h-[62%] opacity-25 [background-image:radial-gradient(var(--beat-dot)_0.75px,transparent_0.75px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-8 sm:px-6"
        style={{
          // The composer grows when the segment panel expands; a fixed padding would cover the last result.
          paddingBottom: composerHeight > 0 ? composerHeight + 8 : 220,
        }}
      >
        {feedItems.length > 0 ? (
          <div className="flex min-h-full w-full flex-col justify-end">
            <StudioGenerationFeed
              items={feedItems}
              onReuse={(item) => {
                const next = applyStudioHistoryItem({
                  item,
                  imageModels,
                  videoModels,
                });
                setMedia(next.media);
                setDraft(next.draft);
                setReferenceUrls(next.referenceUrls);
              }}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <StudioStartHere
              onPickIdea={(prompt) =>
                setDraft((current) => ({ ...current, prompt }))
              }
            />
          </div>
        )}
      </div>

      <StudioComposer
        draft={draft}
        media={media}
        imageModels={imageModels}
        videoModels={videoModels}
        audioModels={audioModels}
        musicStyle={musicStyle}
        onMusicStyleChange={setMusicStyle}
        onInsertLyricsTemplate={() => {
          lyricsAutoInsertedRef.current = true;
          setDraft((current) => ({ ...current, prompt: MUSIC_LYRICS_TEMPLATE }));
        }}
        onInsertLyricsExample={(example) => {
          lyricsAutoInsertedRef.current = true;
          setDraft((current) => ({ ...current, prompt: example.text }));
          setMusicStyle((current) => ({ ...current, ...example.styleHint }));
        }}
        audioRefs={audioRefs}
        onAudioFileSelect={(file) => {
          void uploadLocalProjectAsset({ projectId, file })
            .then((asset) => setAudioRefs((prev) => [...prev, asset.publicUrl]))
            .catch((error: unknown) =>
              setError(error instanceof Error ? error.message : 'Failed to upload audio')
            );
        }}
        onRemoveAudio={(url) =>
          setAudioRefs((prev) => prev.filter((item) => item !== url))
        }
        isBusy={generation.isPending}
        promptCharacterLimit={
          media === 'analysis'
            ? getGenerationPromptMaxChars({ modelId: VIDEO_ANALYSIS_MODEL_ID })
            : getGenerationPromptMaxChars({ modelId: selectedModel?.id })
        }
        takeCount={feedItems.length}
        analysisDepth={analysisDepth}
        analysisFileName={analysisFile?.name ?? null}
        onDraftChange={(next) => {
          if (next.type !== draft.type || next.modelId !== draft.modelId) {
            const nextModels =
              next.type === 'audio'
                ? audioModels
                : next.type === 'video'
                  ? videoModels
                  : imageModels;
            const nextModel =
              findWorkspaceModelOption(nextModels, next.modelId) ??
              nextModels[0] ??
              null;
            if (nextModel) {
              setDraft(
                applyStudioDraftModel({
                  draft: { ...next, type: next.type as CanvasCardMediaType },
                  model: nextModel,
                })
              );
              return;
            }
          }
          setDraft(next);
        }}
        onMediaChange={(nextMedia) => {
          setMedia(nextMedia);
          setReferenceUrls([]);
          // Leaving music mode: drop lyrics that were auto-inserted, otherwise the
          // template text stays in the image / video prompt box.
          if (nextMedia !== 'audio') {
            setAudioRefs([]);
            if (lyricsAutoInsertedRef.current) {
              setDraft((current) => ({ ...current, prompt: '' }));
              lyricsAutoInsertedRef.current = false;
            }
          }
          if (nextMedia === 'analysis') return;
          // nextMedia is already the card type: image / video / audio.
          const nextModels =
            nextMedia === 'audio'
              ? audioModels
              : nextMedia === 'video'
                ? videoModels
                : imageModels;
          const nextModel = nextModels[0] ?? null;
          if (nextModel) {
            setDraft((current) =>
              applyStudioDraftModel({
                draft: { ...current, type: nextMedia },
                model: nextModel,
              })
            );
          }
        }}
        onAnalysisDepthChange={setAnalysisDepth}
        onHeightChange={setComposerHeight}
        onReferenceFileSelect={(file) => {
          void uploadLocalProjectAsset({ projectId, file })
            .then((asset) => {
              setReferenceUrls((current) => [...current, asset.publicUrl]);
            })
            .catch((error: unknown) => {
              setError(
                error instanceof Error ? error.message : 'Failed to upload reference image'
              );
            });
        }}
        onAnalysisFileSelect={(file) => {
          const supported =
            file.type === 'video/mp4' ||
            file.type === 'video/quicktime' ||
            /\.(mp4|mov)$/i.test(file.name);
          if (!supported) {
            setError('Video analysis supports MP4 and MOV files only.');
            return;
          }
          setError('');
          setAnalysisFile(file);
        }}
        onClearAnalysisFile={() => setAnalysisFile(null)}
        referenceUrls={referenceUrls}
        onRemoveReference={(url) =>
          setReferenceUrls((current) =>
            current.filter((item) => item !== url)
          )
        }
        onGenerate={() => {
          setError('');
          generation.mutate();
        }}
      />

      {error ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-[88px] z-30 px-6 text-center text-sm text-[var(--beatcanvas-error)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

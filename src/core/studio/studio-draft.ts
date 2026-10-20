import { getCompatibleDraftModelSettings } from '@/core/beatcanvas/composer';
import type {
  CanvasCardMediaType,
  CanvasGenerationCard,
} from '@/core/beatcanvas/canvas-types';
import { getDraftDefaultsFromModel } from '@/core/beatcanvas/draft-defaults';
import type { ProjectGenerationItem } from '@/core/effects/project-generation-types';
import {
  findWorkspaceModelOption,
  type WorkspaceModelOption,
} from '@/core/effects/workspace-models';
import type { StudioMedia } from '@/core/studio/studio-runtime';

export const STUDIO_DRAFT_ID = 'studio-draft';

export const createStudioDraftCard = ({
  type,
  model,
  prompt = '',
}: {
  type: CanvasCardMediaType;
  model: WorkspaceModelOption | null;
  prompt?: string;
}): CanvasGenerationCard => {
  const defaults = getDraftDefaultsFromModel(type, model);
  const segments = model?.multiSegment
    ? [
        { prompt: '', duration: undefined },
        { prompt: '', duration: undefined },
      ]
    : undefined;

  return {
    id: STUDIO_DRAFT_ID,
    kind: 'generation',
    name: 'Studio draft',
    url: null,
    prompt,
    segments,
    referenceCardIds: [],
    workflowTemplateId: null,
    status: 'idle',
    error: null,
    ...defaults,
    type,
    sourceGenerationId: null,
  };
};

export const applyStudioDraftModel = ({
  draft,
  model,
}: {
  draft: CanvasGenerationCard;
  model: WorkspaceModelOption;
}): CanvasGenerationCard => {
  // 多段导演台：模型支持且尚未有分段时给默认 2 段；已有分段（用户已填）则保留。
  // 不依赖 modelChanged 判断——调用方可能已把 draft.modelId 改为新模型。
  const hasSegments = Array.isArray(draft.segments) && draft.segments.length > 0;
  const segments = model.multiSegment
    ? hasSegments
      ? draft.segments
      : [
          { prompt: '', duration: undefined },
          { prompt: '', duration: undefined },
        ]
    : undefined;
  return {
    ...draft,
    modelId: model.id,
    segments,
    ...getCompatibleDraftModelSettings({
      draftCard: draft,
      model,
    }),
  };
};

export function applyStudioHistoryItem({
  item,
  imageModels,
  videoModels,
}: {
  item: ProjectGenerationItem;
  imageModels: WorkspaceModelOption[];
  videoModels: WorkspaceModelOption[];
}): {
  media: StudioMedia;
  draft: CanvasGenerationCard;
  referenceUrls: string[];
} {
  if (item.mediaType === 'analysis') {
    return {
      media: 'analysis',
      draft: createStudioDraftCard({
        type: 'image',
        model: imageModels[0] ?? null,
        prompt: item.prompt ?? '',
      }),
      referenceUrls: item.referenceVideos,
    };
  }

  const media: StudioMedia = item.mediaType === 'video' ? 'video' : 'image';
  const models = media === 'video' ? videoModels : imageModels;
  const model =
    findWorkspaceModelOption(models, item.modelId) ?? models[0] ?? null;
  const draft = createStudioDraftCard({
    type: media,
    model,
    prompt: item.prompt ?? '',
  });
  const nextDraft = model
    ? applyStudioDraftModel({
        draft: {
          ...draft,
          aspectRatio:
            (item.aspectRatio as CanvasGenerationCard['aspectRatio']) ||
            draft.aspectRatio,
          outputQuality:
            (item.outputQuality as CanvasGenerationCard['outputQuality']) ||
            draft.outputQuality,
          mode: (item.mode as CanvasGenerationCard['mode']) || draft.mode,
          duration:
            (item.duration as CanvasGenerationCard['duration']) ||
            draft.duration,
        },
        model,
      })
    : draft;

  return {
    media,
    draft: nextDraft,
    referenceUrls: item.referenceImages,
  };
}

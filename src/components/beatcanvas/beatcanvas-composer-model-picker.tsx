import { useState } from 'react';
import type { WorkspaceModelOption } from '@/core/effects/workspace-models';
import { getModelIconPathByModelId } from '@/core/workspace-lib/model-icons';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import type { RefObject } from 'react';

import {
  composerFieldButtonClassName,
  composerFieldSlotClassName,
  composerFloatingPanelClassName,
  getComposerOptionRowClassName,
  stopComposerEvent,
} from './beatcanvas-composer-utils';
import { useCanvasComposerLabels } from './use-canvas-composer-labels';

export const resolveModelPickerOpenStateAfterSelection = (
  tone: 'default' | 'batch'
) => false;

const isLocalFreeModel = (model: WorkspaceModelOption) =>
  model.isLocalFree === true;

export function BeatCanvasComposerModelPicker({
  activeDraftId,
  containerRef,
  isDraftBusy,
  isOpen,
  modelOptions,
  onDraftModelChange,
  onOpenChange,
  selectedModelLabel,
  selectedModelId,
  tone = 'default',
}: {
  activeDraftId: string;
  containerRef?: RefObject<HTMLDivElement | null>;
  isDraftBusy: boolean;
  isOpen: boolean;
  modelOptions: WorkspaceModelOption[];
  onDraftModelChange: (draftId: string, modelId: string) => void;
  onOpenChange: (nextOpen: boolean) => void;
  selectedModelLabel: string;
  selectedModelId: string | null;
  tone?: 'default' | 'batch';
}) {
  const labels = useCanvasComposerLabels();
  const selectedModelIconPath = selectedModelId
    ? getModelIconPathByModelId(selectedModelId)
    : null;
  const isBatchTone = tone === 'batch';

  const localModels = modelOptions.filter(isLocalFreeModel);
  const paidModels = modelOptions.filter((model) => !isLocalFreeModel(model));
  const selectedInPaid = paidModels.some((model) => model.id === selectedModelId);
  // null: follow selection; otherwise user-controlled.
  const [paidOpenOverride, setPaidOpenOverride] = useState<boolean | null>(null);
  const paidOpen = paidOpenOverride ?? selectedInPaid;

  const renderModelRow = (model: WorkspaceModelOption) => {
    const isSelected = model.id === selectedModelId;
    const iconPath = getModelIconPathByModelId(model.id);

    return (
      <button
        key={model.id}
        type="button"
        disabled={model.available === false || isDraftBusy}
        onPointerDownCapture={stopComposerEvent}
        onClick={(event) => {
          event.stopPropagation();
          if (!isSelected) {
            onDraftModelChange(activeDraftId, model.id);
            if (!isLocalFreeModel(model)) {
              setPaidOpenOverride(true);
            }
          }
          onOpenChange(resolveModelPickerOpenStateAfterSelection(tone));
        }}
        className={cn(
          getComposerOptionRowClassName(isSelected),
          model.available === false ? 'cursor-not-allowed opacity-60' : ''
        )}
      >
        {iconPath ? (
          <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-white/90 ring-1 ring-black/10">
            <img
              alt=""
              aria-hidden="true"
              src={iconPath}
              className="max-h-3.5 max-w-3.5 object-contain"
            />
          </span>
        ) : (
          <Sparkles className="size-3.5 shrink-0 text-white/50" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-[var(--beat-text-1)]">
            {model.name}
          </span>
        </span>
        {isSelected ? (
          <Check className="size-3.5 shrink-0 text-[var(--beat-accent)]" />
        ) : null}
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        composerFieldSlotClassName,
        !isBatchTone && 'min-w-0 max-w-full',
        isBatchTone && 'lg:max-w-none'
      )}
    >
      <button
        type="button"
        disabled={modelOptions.length === 0 || isDraftBusy}
        onClick={() => {
          onOpenChange(!isOpen);
        }}
        onPointerDownCapture={stopComposerEvent}
        className={cn(
          composerFieldButtonClassName,
          isBatchTone
            ? 'min-h-[44px] w-full rounded-none border-0 bg-transparent px-0 py-0 hover:bg-transparent'
            : 'w-fit max-w-full'
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedModelIconPath ? (
            <span
              className={cn(
                'grid shrink-0 place-items-center rounded-[5px] bg-white/90 ring-1 ring-black/10',
                isBatchTone ? 'size-8' : 'size-4'
              )}
            >
              <img
                alt=""
                aria-hidden="true"
                src={selectedModelIconPath}
                className={cn(
                  'h-auto w-auto object-contain',
                  isBatchTone ? 'max-h-6 max-w-6' : 'max-h-3 max-w-3'
                )}
              />
            </span>
          ) : (
            <Sparkles
              className={cn(
                'shrink-0 text-[var(--beat-graph)]',
                isBatchTone ? 'size-5' : 'size-3.5'
              )}
            />
          )}
          <span className="min-w-0">
            <span
              className={cn(
                'block line-clamp-1 min-w-0',
                isBatchTone
                  ? 'text-[18px] font-semibold tracking-[-0.04em] text-white'
                  : 'text-[12px] font-semibold text-white'
              )}
            >
              {selectedModelLabel}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'pointer-events-none size-3.5 shrink-0 transition-transform duration-200',
            isBatchTone ? 'text-[var(--beat-text-2)]' : 'text-white/45',
            isOpen ? 'rotate-180' : ''
          )}
        />
      </button>

      {isOpen ? (
        <div
          className={cn(
            composerFloatingPanelClassName,
            'left-0 w-[min(360px,calc(100vw-48px))]'
          )}
          onPointerDownCapture={stopComposerEvent}
        >
          <div className="space-y-1.5">
            {localModels.map((model) => renderModelRow(model))}

            {paidModels.length > 0 ? (
              <div className="space-y-1.5 pt-1.5">
                <button
                  type="button"
                  onPointerDownCapture={stopComposerEvent}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPaidOpenOverride(!paidOpen);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-left text-[11px] font-medium text-[var(--beat-text-2)] transition-colors hover:bg-white/5"
                >
                  <ChevronDown
                    className={cn(
                      'size-3 shrink-0 transition-transform duration-200',
                      paidOpen ? 'rotate-0' : '-rotate-90'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {labels.paidModelsLabel}
                  </span>
                  <span className="shrink-0 rounded-[4px] bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--beat-text-2)]">
                    {paidModels.length}
                  </span>
                </button>
                {paidOpen ? (
                  <div className="space-y-1.5">
                    {paidModels.map((model) => renderModelRow(model))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

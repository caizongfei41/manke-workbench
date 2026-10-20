import {
  Clapperboard,
  Film,
  ImagePlus,
  Layers,
  Plus,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Table2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageHoverPreview } from '@/components/app/image-hover-preview';
import { DramaViewport, type ViewportMarker } from '@/components/drama/drama-viewport';
import {
  classifyGenerationFailure,
  type GenerationFailureKind,
} from '@/core/app/comfy-monitor';
import { CastLibraryButton } from '@/components/drama/cast-library-button';
import { HelpPopover, type HelpId } from '@/components/drama/help-popover';
import { HintTip } from '@/components/app/hint-tip';
import {
  DRAMA_ASPECT_RATIO,
  DRAMA_MODEL_ID,
  MAX_SHOT_VERSIONS,
  analyzeScript,
  linkAssetsToShots,
  defaultLinks,
  mergeAssets,
  buildShotsFromScript,
  createEmptyDramaDocument,
  dramaTemplate,
  loadDramaDocument,
  serializeDramaDocument,
  totalSeconds,
  type DramaDocument,
  type DramaShot,
} from '@/core/drama/drama-document';
import { ASSET_KIND_LABELS, type ScriptAsset } from '@/core/effects/script-document';
import {
  ENHANCE_RULES,
  enhancePrompt,
  withSubtitleSuppression,
  type EnhanceRuleId,
} from '@/core/drama/prompt-enhance';
import {
  EXPORT_PRESETS,
  buildAssSubtitle,
  buildSubtitleCues,
  presetPlayRes,
  type ExportPresetId,
  stripDialogueMarkup,
} from '@/core/drama/subtitles';
import {
  COMMON_LORAS,
  DIRECTOR_FIELDS,
  DIRECTOR_GROUP_LABELS,
  LORA_SLOT_COUNT,
  getDefaultDirectorGlobal,
} from '@/core/effects/aicg3d-director';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';

/**
 * AI short-drama canvas.
 *
 * A left-to-right pipeline: script → storyboard → assets (shared + per shot) →
 * segment workbench ×N → final video stage. Connectors are hand-drawn SVG: the
 * nodes live in fixed columns with a vertical flow, so a general drag engine
 * would add risk without adding anything.
 *
 * Consistency comes from the shared assets: a character that is attached once
 * gives every shot the same reference image.
 */

type Props = {
  projectId: string;
  /** Saved drama state (a JSON string inside the project snapshot). */
  initialDocument?: string | null;
  onPersist: (dramaJson: string) => void;
};

type ResolvedRef = { kind: string; name: string; description?: string; imageUrl: string };

const shotStatusLabel = (status: DramaShot['status']) => {
  if (status === 'succeeded') return m['drama.shot.done']();
  if (status === 'running') return m['drama.shot.running']();
  if (status === 'failed') return m['drama.shot.failed']();
  return m['drama.shot.idle']();
};

// Columns are sized so the whole pipeline fits a 1600px viewport without
// hunting for the final stage. Cards are taller than they look once the prompt,
// chips and buttons are in, so the row pitch has to clear that height or the
// workbenches overlap.
const COLUMN = {
  script: 0,
  board: 290,
  assets: 580,
  shots: 880,
  final: 1170,
};

const NODE_WIDTH = 270;
const SHOT_PITCH = 340;

function NodeShell({
  title,
  subtitle,
  icon,
  accent,
  children,
  width = NODE_WIDTH,
  helpId,
  ports,
  collapsed,
  onToggleCollapse,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
  width?: number;
  /** Hides the body and keeps only the header row. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Shows the floating usage notes button in the header. */
  helpId?: HelpId;
  /** Wiring handles: an input on the left edge, an output on the right. */
  ports?: { inputId?: string; onStartLink?: (event: React.PointerEvent<HTMLSpanElement>) => void };
}) {
  return (
    <div className="relative" style={{ width }}>
      <div
        className={cn(
          'overflow-hidden rounded-[16px] border bg-[var(--beat-surface)] shadow-[0_18px_44px_rgba(0,0,0,0.18)]',
          accent ? 'border-[var(--beat-accent)]/45' : 'border-ink/[0.1]'
        )}
      >
      <div
        data-drama-drag-handle="true"
        className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-ink/[0.08] px-3 py-2.5 active:cursor-grabbing"
      >
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-[7px]',
            accent
              ? 'bg-[var(--beat-accent)]/18 text-[var(--beat-accent)]'
              : 'bg-ink/[0.07] text-[var(--beat-text-2)]'
          )}
        >
          {icon}
        </span>
        {onToggleCollapse ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={collapsed ? 'expand' : 'collapse'}
            aria-expanded={!collapsed}
            className="ml-auto grid size-5 shrink-0 place-items-center rounded-[5px] text-[var(--beat-text-3)] transition hover:bg-ink/[0.06] hover:text-ink"
          >
            {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </button>
        ) : null}
        {helpId ? <HelpPopover id={helpId} className="ml-auto" /> : null}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-medium leading-none text-[var(--beat-text-1)]">
            {title}
          </span>
          {subtitle ? (
            <span className="mt-1 truncate text-[13.5px] leading-none text-[var(--beat-text-3)]">
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
        {collapsed ? null : <div className="p-3">{children}</div>}
      </div>
      {ports?.inputId ? (
        <span
          data-drama-input-port={ports.inputId}
          title={m['drama.wire.drop']()}
          className="absolute -left-[7px] top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-[var(--beat-accent)] bg-[var(--beat-surface)] transition hover:scale-125"
        />
      ) : null}
      {ports?.onStartLink ? (
        <span
          onPointerDown={ports.onStartLink}
          title={m['drama.wire.drag']()}
          className="absolute -right-[7px] top-1/2 size-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-[var(--beat-accent)] bg-[var(--beat-surface)] transition hover:scale-125"
        />
      ) : null}
    </div>
  );
}

export function DramaCanvas({ projectId, initialDocument, onPersist }: Props) {
  const [doc, setDoc] = useState<DramaDocument>(() => loadDramaDocument(initialDocument));
  const [busyShot, setBusyShot] = useState<string | null>(null);
  // Which take each shot is previewing (transient; adopting is a separate act).
  const [previewVersion, setPreviewVersion] = useState<Record<string, number>>({});
  const shotFileRef = useRef<HTMLInputElement | null>(null);
  const [shotUploadTarget, setShotUploadTarget] = useState<string | null>(null);
  const publicFileRef = useRef<HTMLInputElement | null>(null);
  const [publicUploadTarget, setPublicUploadTarget] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Undo/redo -------------------------------------------------------
  // A plain snapshot stack. Pushes are throttled so a continuous drag becomes
  // one history entry instead of two hundred, which is what an undo should feel
  // like: back to where the card was before you grabbed it.
  const historyRef = useRef<DramaDocument[]>([]);
  const historyIndexRef = useRef(-1);
  const lastPushRef = useRef(0);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const syncHistoryState = () => {
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
  };

  useEffect(() => {
    if (historyRef.current.length === 0) {
      historyRef.current = [doc];
      historyIndexRef.current = 0;
      syncHistoryState();
    }
    // Seed the baseline once, on mount.
  }, []);

  const updateDoc = useCallback(
    (updater: (current: DramaDocument) => DramaDocument) => {
      setDoc((current) => {
        const next = updater(current);
        if (next === current) return current;
        const now = Date.now();
        if (now - lastPushRef.current > 600) {
          const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
          trimmed.push(current);
          if (trimmed.length > 60) trimmed.shift();
          historyRef.current = trimmed;
          historyIndexRef.current = trimmed.length - 1;
          lastPushRef.current = now;
          syncHistoryState();
        }
        return next;
      });
    },
    []
  );

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const target = historyRef.current[historyIndexRef.current];
    lastPushRef.current = 0;
    setDoc(target);
    syncHistoryState();
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const target = historyRef.current[historyIndexRef.current];
    lastPushRef.current = 0;
    setDoc(target);
    syncHistoryState();
  }, []);

  // Debounce persistence so typing does not write the snapshot on every key.
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      onPersist(serializeDramaDocument(doc));
    }, 700);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [doc, onPersist]);

  const analysis = useMemo(() => analyzeScript(doc.script), [doc.script]);

  /** Saved position, or the default pipeline slot. */
  const posOf = (key: string, fallback: { x: number; y: number }) =>
    doc.positions[key] ?? fallback;

  /**
   * Inline style for a node. Positions are stored as {x, y}; CSS wants left/top,
   * and passing the raw object silently positioned everything at the origin.
   */
  const posStyle = (key: string) => {
    const point = posOf(key, defaultPos(key));
    return { left: point.x, top: point.y };
  };

  const defaultPos = (key: string): { x: number; y: number } => {
    if (key === 'script') return { x: COLUMN.script, y: 40 };
    if (key === 'board') return { x: COLUMN.board, y: 40 };
    if (key === 'assets') return { x: COLUMN.assets, y: 40 };
    if (key === 'params') return { x: COLUMN.assets, y: 430 };
    if (key === 'final') return { x: COLUMN.final, y: 40 };
    const index = Math.max(0, doc.shots.findIndex((shot) => shot.id === key));
    return { x: COLUMN.shots, y: shotY(index) };
  };

  // Measured rects drive the connectors, so they follow a node wherever it is
  // dragged instead of assuming the fixed column layout.
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [rects, setRects] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});

  const measure = useCallback(() => {
    const next: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const [id, el] of nodeRefs.current) {
      next[id] = {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
    }
    setRects((current) => {
      const same =
        Object.keys(current).length === Object.keys(next).length &&
        Object.entries(next).every(([id, rect]) => {
          const prev = current[id];
          return (
            prev &&
            prev.x === rect.x &&
            prev.y === rect.y &&
            prev.w === rect.w &&
            prev.h === rect.h
          );
        });
      return same ? current : next;
    });
  }, []);

  // Rects cannot rely on requestAnimationFrame alone: the one scheduled at mount
  // may never run (background tab, commit timing), and then nodes are never
  // measured — no wires, no drag math. Measure now and track resizes too.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    resizeObserverRef.current = observer;
    for (const el of nodeRefs.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [measure]);

  // One callback per id, cached: a fresh arrow each render makes React detach and
  // re-attach every ref on every render, and since measuring sets state that turned
  // into an endless render loop (React error #185).
  const nodeRefCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());

  // Moving a node changes its offsetLeft without changing its size, which a
  // ResizeObserver cannot see; re-measure whenever the document changes so the
  // wires follow the card.
  useEffect(() => {
    measure();
  }, [doc, measure]);

  const registerNode = useCallback(
    (id: string) => {
      const existing = nodeRefCallbacks.current.get(id);
      if (existing) return existing;
      const callback = (el: HTMLDivElement | null) => {
        const observer = resizeObserverRef.current;
        if (el) {
          nodeRefs.current.set(id, el);
          observer?.observe(el);
        } else {
          const previous = nodeRefs.current.get(id);
          if (previous) observer?.unobserve(previous);
          nodeRefs.current.delete(id);
        }
        // Layout is already computed by the time a ref callback runs.
        measure();
        requestAnimationFrame(measure);
      };
      nodeRefCallbacks.current.set(id, callback);
      return callback;
    },
    [measure]
  );

  // Dragging a node by its header.
  const dragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const startNodeDrag = (id: string) => (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a')) return;
    if (event.button !== 0) return;
    const origin = posOf(id, defaultPos(id));
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    };
    setDraggingId(id);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const moveNodeDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (dx === 0 && dy === 0) return;
    // Divide by zoom, or the card lags behind the cursor when scaled.
    const k = viewScaleRef.current || 1;
    const rawX = drag.originX + dx / k;
    const rawY = drag.originY + dy / k;
    const snapped = snapPosition(drag.id, rawX, rawY);
    updateDoc((current) => ({
      ...current,
      positions: {
        ...current.positions,
        [drag.id]: { x: Math.round(snapped.x), y: Math.round(snapped.y) },
      },
    }));
  };

  const endNodeDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDraggingId(null);
    }
  };

  const viewScaleRef = useRef(1);

  /**
   * Snap a dragged card to its neighbours.
   *
   * Hand-placing forty workbenches produces near-misses that read as sloppy, so
   * edges and centres of other nodes win when they are within a few screen
   * pixels; otherwise fall back to an 8px grid. The threshold is divided by zoom
   * so the feel stays the same at any scale.
   */
  const snapPosition = (id: string, x: number, y: number) => {
    const self = rects[id];
    const k = viewScaleRef.current || 1;
    const threshold = 7 / k;
    if (!self) return { x, y };

    const others = Object.entries(rects)
      .filter(([otherId]) => otherId !== id)
      .map(([, rect]) => rect);

    const pick = (value: number, candidates: number[]) => {
      let best = value;
      let bestDelta = threshold + 1;
      for (const candidate of candidates) {
        const delta = Math.abs(value - candidate);
        if (delta <= threshold && delta < bestDelta) {
          best = candidate;
          bestDelta = delta;
        }
      }
      return bestDelta <= threshold ? best : value;
    };

    const xs: number[] = [];
    const ys: number[] = [];
    for (const rect of others) {
      xs.push(rect.x, rect.x + rect.w - self.w, rect.x + (rect.w - self.w) / 2);
      ys.push(rect.y, rect.y + rect.h - self.h, rect.y + (rect.h - self.h) / 2);
    }

    const snappedX = pick(x, xs);
    const snappedY = pick(y, ys);
    return {
      x: snappedX === x ? Math.round(x / 8) * 8 : snappedX,
      y: snappedY === y ? Math.round(y / 8) * 8 : snappedY,
    };
  };
  const grandTotal = totalSeconds(doc.shots);

  const setShot = useCallback((id: string, patch: Partial<DramaShot>) => {
    updateDoc((current) => ({
      ...current,
      shots: current.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
    }));
  }, []);

  const splitScript = () => {
    const shots = buildShotsFromScript(doc.script);
    const merged = mergeAssets(doc.publicAssets, analysis.assets);
    const alive = new Set(merged.map((asset) => asset.id));
    const relinked = linkAssetsToShots(shots, analysis.assets, merged);
    const prunedShots = relinked.map((shot) => ({
      ...shot,
      publicAssetIds: shot.publicAssetIds.filter((id) => alive.has(id)),
    }));
    updateDoc((current) => {
      // Re-splitting replaces the shots, so their wires have to be rebuilt too —
      // otherwise every new workbench starts unlinked and silently leaves the
      // film. Stage-to-stage wires the user changed are kept; shot wires are
      // recreated for the new shot ids.
      const stageIds = new Set(['script', 'board', 'assets', 'final']);
      const keptStageLinks = current.links.filter(
        (link) => stageIds.has(link.from) && stageIds.has(link.to)
      );
      const shotLinks = defaultLinks(prunedShots.map((shot) => shot.id)).filter(
        (link) => !stageIds.has(link.from) || !stageIds.has(link.to)
      );
      return {
        ...current,
        shots: prunedShots,
        publicAssets: merged,
        links: [...keptStageLinks, ...shotLinks],
      };
    });
  };

  const addShot = () => {
    updateDoc((current) => ({
      ...current,
      shots: [
        ...current.shots,
        {
          id: `shot-${Date.now().toString(36)}`,
          prompt: '',
          seconds: 3,
          publicAssetIds: [],
          ownImageUrls: [],
          videoUrl: null,
          status: 'idle',
          error: null,
        },
      ],
    }));
    // A node created off-screen is a node that vanished; bring it into view.
    const index = doc.shots.length;
    const spot = posOf(`pending`, { x: COLUMN.shots, y: shotY(index) });
    viewportApi.current?.centerOn(spot.x + NODE_WIDTH / 2, spot.y + 150);
  };

  /** Images for one shot: shared assets first (character → scene → prop), then its own. */
  /**
   * Number of images that will actually be sent for a shot. Assets without an
   * uploaded image are skipped, so counting ids would overstate what the model
   * receives — that mismatch is why the label used to say "1 reference" while
   * the job carried none.
   */
  /**
   * Images for a shot, in the order H3 will number them: shared assets first
   * (character → scene → prop), then the shot's own uploads.
   *
   * Assets without an image are skipped. They used to be counted anyway, and a
   * cast-typo cast cast to string[] meant nothing was sent at all — both
   * showed up as "1 reference" while the job carried zero.
   */
  /**
   * Merge the board's parameters over the AICG3D defaults.
   *
   * The canvas used to send a hardcoded 480P block, so nothing on the board could
   * change resolution, sampler or LoRA. Only keys the user actually touched are
   * sent; everything else keeps the template's own value.
   */
  const dramaGlobalParameters = () => {
    const defaults = getDefaultDirectorGlobal();
    const out: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(doc.params ?? {})) {
      if (defaults[key] !== value && value !== '' && value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  };

  const activeDramaLoras = () =>
    (doc.loras ?? []).filter((lora) => lora.file && lora.file !== 'none').slice(0, LORA_SLOT_COUNT);

  const setParam = (key: string, value: string | number | boolean) =>
    updateDoc((current) => ({ ...current, params: { ...current.params, [key]: value } }));

  const setLora = (index: number, patch: { file?: string; strength?: number }) =>
    updateDoc((current) => {
      const next = [...(current.loras ?? [])];
      while (next.length <= index) next.push({ file: 'none', strength: 1 });
      next[index] = { ...next[index], ...patch };
      return { ...current, loras: next };
    });

  const linkKey = (link: { from: string; to: string }) => `${link.from}->${link.to}`;
  const linkSet = useMemo(() => new Set(doc.links.map(linkKey)), [doc.links]);

  const hasLink = (from: string, to: string) => linkSet.has(`${from}->${to}`);

  // ---- Selection --------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchSeconds, setBatchSeconds] = useState(3);
  const [batchAssetId, setBatchAssetId] = useState('');
  const viewportApi = useRef<{ centerOn: (x: number, y: number) => void } | null>(null);
  const FIXED_NODES = ['script', 'board', 'assets', 'params', 'final'];

  /** Only workbenches can be removed; the pipeline stages are structure. */
  const removable = (id: string) => !FIXED_NODES.includes(id);

  const onMarquee = (rect: { x: number; y: number; w: number; h: number } | null, additive: boolean) => {
    if (!rect) {
      if (!additive) setSelectedIds([]);
      return;
    }
    const hits = Object.entries(rects)
      .filter(([, box]) =>
        box.x < rect.x + rect.w &&
        box.x + box.w > rect.x &&
        box.y < rect.y + rect.h &&
        box.y + box.h > rect.y
      )
      .map(([id]) => id);
    setSelectedIds((current) =>
      additive ? [...new Set([...current, ...hits])] : hits
    );
  };

  const deleteSelected = () => {
    const targets = selectedIds.filter(removable);
    if (targets.length === 0) return;
    updateDoc((current) => ({
      ...current,
      shots: current.shots.filter((shot) => !targets.includes(shot.id)),
      links: current.links.filter(
        (link) => !targets.includes(link.from) && !targets.includes(link.to)
      ),
      positions: Object.fromEntries(
        Object.entries(current.positions).filter(([id]) => !targets.includes(id))
      ),
    }));
    setSelectedIds([]);
  };

  /** Switch which take goes into the film. Previewing is a separate action. */
  const sendToEditor = async () => {
    const assetId = doc.finalVideoUrl?.match(/\/assets\/([0-9a-f-]{36})/i)?.[1];
    if (!assetId) return;
    try {
      const res = await fetch(`/api/app/projects/${projectId}/send-to-editor`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-beatapi-workspace-request': '1',
        },
        body: JSON.stringify({ assetId, name: m['drama.final.editorName']({ time: new Date().toLocaleString() }) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.projectId) return;
      window.open(`/zh/canvas/${json.projectId}`, '_blank');
    } catch {
      // A failed handoff leaves the board untouched.
    }
  };

  const adoptVersion = (shotId: string, versionId: string) =>
    updateDoc((current) => ({
      ...current,
      shots: current.shots.map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              videoUrl:
                (shot.versions ?? []).find((v) => v.id === versionId)?.url ?? shot.videoUrl,
            }
          : shot
      ),
    }));

  // Explicit map: paraglide's message table is typed, so a composed key will not index it.
  const PRESET_LABELS: Record<ExportPresetId, () => string> = {
    source: m['drama.preset.source'],
    vertical: m['drama.preset.vertical'],
    vertical720: m['drama.preset.vertical720'],
    square: m['drama.preset.square'],
    landscape: m['drama.preset.landscape'],
  };

  // Subtitles are burned by us, so the model must not draw the dialogue too.
  const effectiveEnhance = () => withSubtitleSuppression(doc.enhance, doc.subtitles);

  // Name the failure and say what to do about it; a raw stack tells nobody whether
  // retrying is even worth it.
  const FAILURE_LABELS: Record<GenerationFailureKind, () => string> = {
    outOfMemory: m['fail.outOfMemory'],
    timeout: m['fail.timeout'],
    missingNode: m['fail.missingNode'],
    missingModel: m['fail.missingModel'],
    cancelled: m['fail.cancelled'],
    invalidInput: m['fail.invalidInput'],
    serverDown: m['fail.serverDown'],
    unknown: m['fail.unknown'],
  };

  const FAILURE_HINTS: Record<GenerationFailureKind, () => string> = {
    outOfMemory: m['fail.hint.outOfMemory'],
    timeout: m['fail.hint.timeout'],
    missingNode: m['fail.hint.missingNode'],
    missingModel: m['fail.hint.missingModel'],
    cancelled: m['fail.hint.cancelled'],
    invalidInput: m['fail.hint.invalidInput'],
    serverDown: m['fail.hint.serverDown'],
    unknown: m['fail.hint.unknown'],
  };

  const ENHANCE_LABELS: Record<EnhanceRuleId, () => string> = {
    soloSubject: m['drama.enhance.soloSubject'],
    lockCamera: m['drama.enhance.lockCamera'],
    lockLight: m['drama.enhance.lockLight'],
    noText: m['drama.enhance.noText'],
  };

  const usesSharedAssets = (shotId: string) => hasLink('assets', shotId);
  const isInFinal = (shotId: string) => hasLink(shotId, 'final');

  const resolveShotRefs = (shot: DramaShot): ResolvedRef[] => {
    const order: Record<string, number> = { character: 0, scene: 1, prop: 2 };
    // Cutting the assets wire leaves the shot with only its own images.
    const picked = (usesSharedAssets(shot.id) ? shot.publicAssetIds : [])
      
      .map((id) => doc.publicAssets.find((a) => a.id === id))
      .filter((a): a is ScriptAsset => !!a && !!a.imageUrl)
      .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
      .map((a) => ({
        kind: a.kind as string,
        name: a.name,
        description: a.description,
        imageUrl: a.imageUrl as string,
      }));
    const own = shot.ownImageUrls.map((url) => ({
      kind: 'prop' as string,
      name: '',
      description: undefined,
      imageUrl: url,
    }));
    const seen = new Set<string>();
    return [...picked, ...own].filter((item) => {
      if (seen.has(item.imageUrl)) return false;
      seen.add(item.imageUrl);
      return true;
    });
  };

  const resolveImages = (shot: DramaShot): string[] =>
    resolveShotRefs(shot).map((r) => r.imageUrl);

  const resolveRefs = (shot: DramaShot) =>
    resolveShotRefs(shot).map((r) => ({
      kind: r.kind,
      name: r.name,
      description: r.description,
    }));

  const uploadShotImage = (shotId: string, file: File) => {
    void uploadLocalProjectAsset({ projectId, file })
      .then((asset) => {
        updateDoc((current) => ({
          ...current,
          shots: current.shots.map((shot) =>
            shot.id === shotId
              ? { ...shot, ownImageUrls: [...shot.ownImageUrls, asset.publicUrl] }
              : shot
          ),
        }));
      })
      .catch(() => {});
  };

  const uploadPublicImage = (assetId: string, file: File) => {
    void uploadLocalProjectAsset({ projectId, file })
      .then((asset) => {
        updateDoc((current) => ({
          ...current,
          publicAssets: current.publicAssets.map((a) =>
            a.id === assetId
              ? { ...a, imageUrl: asset.publicUrl, source: 'uploaded' as const }
              : a
          ),
        }));
      })
      .catch(() => {});
  };

  /** Set a public asset's portrait, e.g. after picking one from the cast library. */
  // Uniform pacing is the common edit: changing seconds one card at a time is busywork
  // A character usually belongs in every segment; adding it shot by shot is the same
  // busywork as per-card seconds.
  // The prefix is a separate field, so turning it off restores the hand-written
  // prompts exactly; rewriting every segment would be a one-way edit.
  const composePrompt = (prompt: string) => {
    const body = stripDialogueMarkup(prompt);
    const prefix = (doc.promptPrefix ?? '').trim();
    return prefix ? `${prefix}，${body}` : body;
  };

  const applyAssetToAll = (assetId: string) =>
    updateDoc((current) => ({
      ...current,
      shots: current.shots.map((shot) =>
        shot.publicAssetIds.includes(assetId)
          ? shot
          : { ...shot, publicAssetIds: [...shot.publicAssetIds, assetId] }
      ),
    }));

  const removeAssetFromAll = (assetId: string) =>
    updateDoc((current) => ({
      ...current,
      shots: current.shots.map((shot) => ({
        ...shot,
        publicAssetIds: shot.publicAssetIds.filter((id) => id !== assetId),
      })),
    }));

  const applySecondsToAll = (seconds: number) =>
    updateDoc((current) => ({
    ...current,
    shots: current.shots.map((shot) => ({ ...shot, seconds })),
    }));

  const collapseAllShots = () =>
    updateDoc((current) => ({ ...current, collapsedShots: current.shots.map((shot) => shot.id) }));

  const expandAllShots = () => updateDoc((current) => ({ ...current, collapsedShots: [] }));

  const isShotCollapsed = (shotId: string) => (doc.collapsedShots ?? []).includes(shotId);

  const toggleShotCollapsed = (shotId: string) =>
    updateDoc((current) => {
      const collapsed = current.collapsedShots ?? [];
      return {
        ...current,
        collapsedShots: collapsed.includes(shotId)
          ? collapsed.filter((id) => id !== shotId)
          : [...collapsed, shotId],
      };
    });

  const setAssetImage = (assetId: string, url: string) =>
    updateDoc((current) => ({
      ...current,
      publicAssets: current.publicAssets.map((asset) =>
        asset.id === assetId ? { ...asset, imageUrl: url, source: 'uploaded' as const } : asset
      ),
    }));

  const generateShot = async (shot: DramaShot): Promise<boolean> => {
    setBusyShot(shot.id);
    setShot(shot.id, { status: 'running', error: null });
    try {
      const images = resolveImages(shot);
      const refs = resolveRefs(shot);
      const res = await fetch('/api/effects/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-beatapi-workspace-request': '1',
        },
        body: JSON.stringify({
          generation: {
            version: 2,
            projectId,
            modelId: DRAMA_MODEL_ID,
            mode: 'video',
            prompt: enhancePrompt(composePrompt(shot.prompt), effectiveEnhance()) || 'short drama shot',
            references: [],
            parameters: {
              aspect_ratio: DRAMA_ASPECT_RATIO,
              wmDuration: '12s',
              wmOutputQuality: '480p',
              director_global: dramaGlobalParameters(),
              director_loras: activeDramaLoras(),
              director_segments: [
                {
                  prompt: enhancePrompt(composePrompt(shot.prompt), effectiveEnhance()),
                  seconds: shot.seconds,
                  imageUrls: images,
                  refs,
                },
              ],
            },
          },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const wmTaskId = json?.wmTaskId;
      if (!wmTaskId) throw new Error(m['drama.error.noTask']());

      // Poll this shot until it settles.
      for (let i = 0; i < 200; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await fetch(`/api/effects/status?wmTaskId=${wmTaskId}`).then((r) =>
          r.json()
        );
        if (status?.status === 'succeeded') {
          const gens = await fetch(`/api/app/projects/${projectId}/generations`).then((r) =>
            r.json()
          );
          const item = (gens.items ?? []).find((g: { id: string }) => g.id === wmTaskId);
          const url = item?.resultUrl ?? null;
          // Every take is kept; the newest is adopted, older ones stay pickable.
          setShot(shot.id, {
            status: 'succeeded',
            videoUrl: url,
            versions: url
              ? [
                  { id: String(wmTaskId), url, createdAt: Date.now() },
                  ...(shot.versions ?? []),
                ].slice(0, MAX_SHOT_VERSIONS)
              : (shot.versions ?? []),
          });
          return true;
        }
        if (status?.status === 'failed') {
          setShot(shot.id, {
            status: 'failed',
            error: String(status.error ?? m['drama.error.failed']()),
          });
          return false;
        }
      }
      // A timeout counts as a failure; the caller decides whether to retry.
      setShot(shot.id, { status: 'failed', error: m['drama.error.timeout']() });
      return false;
    } catch (error) {
      setShot(shot.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : m['drama.error.failed'](),
      });
      return false;
    } finally {
      setBusyShot(null);
    }
  };

  /**
   * Join the clips that already exist instead of re-rendering the whole film.
   *
   * Re-running forty segments to change one line takes an hour; concatenating
   * the finished clips takes seconds and loses nothing.
   */
  // ---- Resumable pipeline ----------------------------------------------
  // The whole film used to be one graph: a failure at segment 30 threw away
  // thirty minutes of work. Each shot is now its own job and its result is
  // persisted immediately, so a run resumes where it stopped.
  const [pipeline, setPipeline] = useState<{
    running: boolean;
    done: number;
    total: number;
  }>({ running: false, done: 0, total: 0 });
  const stopPipelineRef = useRef(false);

  const pendingShots = () =>
    doc.shots.filter(
      (shot) => isInFinal(shot.id) && (!shot.videoUrl || shot.status === 'failed')
    );

  const runPipeline = async ({ retry }: { retry: boolean }) => {
    if (pipeline.running) return;
    const queue = doc.shots.filter(
      (shot) =>
        isInFinal(shot.id) &&
        (!shot.videoUrl || (retry && shot.status === 'failed'))
    );
    if (queue.length === 0) return;

    stopPipelineRef.current = false;
    setPipeline({ running: true, done: 0, total: queue.length });

    for (let index = 0; index < queue.length; index += 1) {
      if (stopPipelineRef.current) break;
      setPipeline({ running: true, done: index, total: queue.length });
      // Each setShot persists the snapshot, so every shot is a checkpoint.
      await generateShot(queue[index]);
    }

    setPipeline({ running: false, done: 0, total: 0 });
    stopPipelineRef.current = false;
  };

  const bgmFileRef = useRef<HTMLInputElement | null>(null);

  const uploadBgm = async (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const res = await fetch(`/api/app/projects/${projectId}/assets`, {
        method: 'POST',
        headers: { 'x-beatapi-workspace-request': '1' },
        body: form,
      });
      const json = await res.json().catch(() => null);
      const assetId = json?.assetId ?? json?.id ?? json?.asset?.id;
      if (!res.ok || !assetId) return;
      setDoc((current) => ({
        ...current,
        bgmAssetId: assetId,
        bgmName: file.name,
      }));
    } catch {
      // A failed upload just means no music; the film still renders.
    }
  };

  const concatGenerated = async () => {
    const assetIds = doc.shots
      .filter((shot) => isInFinal(shot.id) && !!shot.videoUrl)
      .map((shot) => shot.videoUrl?.match(/\/assets\/([0-9a-f-]{36})/i)?.[1])
      .filter((id): id is string => !!id);
    if (assetIds.length === 0) return;

    setDoc((current) => ({ ...current, finalStatus: 'running' }));
    try {
      const res = await fetch(`/api/app/projects/${projectId}/concat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-beatapi-workspace-request': '1',
        },
        body: JSON.stringify({
          assetIds,
          subtitles: doc.subtitles
            ? buildAssSubtitle(
                buildSubtitleCues(
                  doc.shots
                    .filter((shot) => isInFinal(shot.id))
                    .map((shot) => ({ prompt: stripDialogueMarkup(shot.prompt), seconds: shot.seconds }))
                ),
                presetPlayRes(doc.exportPreset)
              )
            : '',
          exportPreset: doc.exportPreset,
          bgmAssetId: doc.bgmAssetId ?? '',
          bgmVolume: doc.bgmVolume,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.publicUrl) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setDoc((current) => ({
        ...current,
        finalStatus: 'succeeded',
        finalVideoUrl: json.publicUrl,
      }));
    } catch {
      setDoc((current) => ({ ...current, finalStatus: 'failed' }));
    }
  };

  const generatedClips = doc.shots.filter(
    (shot) => isInFinal(shot.id) && !!shot.videoUrl
  ).length;

  const generateFinal = async () => {
    // Both controls in this panel — the export preset and the burned-in subtitles —
    // only take effect on the concat path. Assembling used to re-render a fresh video
    // at the model's native size instead, so three visible settings silently did
    // nothing. With every clip on disk, assembling now means concatenating.
    const inFinal = doc.shots.filter((shot) => isInFinal(shot.id));
    const missing = inFinal.filter((shot) => !shot.videoUrl);
    if (!inFinal.length || missing.length) {
      updateDoc((current) => ({
        ...current,
        finalStatus: 'failed',
        finalError:
          missing.length > 0
            ? m['drama.final.needClips']({ count: missing.length })
            : m['drama.final.needShots'](),
      }));
      return;
    }
    await concatGenerated();
  };

  const shotY = (index: number) => 150 + index * SHOT_PITCH;
  const canvasHeight = Math.max(760, shotY(doc.shots.length) + 60);

  // ---- Wiring -----------------------------------------------------------

  const toggleLink = (from: string, to: string) => {
    if (from === to) return;
    updateDoc((current) => {
      const exists = current.links.some((l) => l.from === from && l.to === to);
      return {
        ...current,
        links: exists
          ? current.links.filter((l) => !(l.from === from && l.to === to))
          : [...current.links, { from, to }],
      };
    });
  };

  const autoWire = () =>
    updateDoc((current) => ({
      ...current,
      links: defaultLinks(current.shots.map((shot) => shot.id)),
    }));

  // Dragging a wire out of an output port.
  const [pendingLink, setPendingLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const linkDragRef = useRef<{ from: string; pointerId: number } | null>(null);

  const beginLink = (from: string) => (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    linkDragRef.current = { from, pointerId: event.pointerId };
    setPendingLink({ from, x: 0, y: 0 });
  };

  useEffect(() => {
    if (!pendingLink) return;
    const onMove = (event: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const k = viewScaleRef.current || 1;
      setPendingLink((current) =>
        current
          ? {
              ...current,
              x: (event.clientX - rect.left) / k,
              y: (event.clientY - rect.top) / k,
            }
          : current
      );
    };
    const onUp = (event: PointerEvent) => {
      const drag = linkDragRef.current;
      linkDragRef.current = null;
      setPendingLink(null);
      if (!drag) return;
      const target = (event.target as HTMLElement | null)?.closest('[data-drama-input-port]');
      const to = target?.getAttribute('data-drama-input-port');
      if (to) toggleLink(drag.from, to);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pendingLink, hasLink]);

  const stageRef = useRef<HTMLDivElement | null>(null);

  const edgeFor = (fromId: string, toId: string) => {
    const from = rects[fromId];
    const to = rects[toId];
    if (!from || !to) return null;
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const bend = Math.max(40, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 6} ${y2}`;
  };

  const edges = doc.links
    .map((link) => {
      const path = edgeFor(link.from, link.to);
      const strong = link.from === 'script' || link.from === 'board';
      return path ? { path, strong, key: linkKey(link), from: link.from, to: link.to } : null;
    })
    .filter((edge): edge is { path: string; strong: boolean; key: string; from: string; to: string } => edge !== null);

  const ghostPath = pendingLink
    ? (() => {
        const from = rects[pendingLink.from];
        if (!from) return null;
        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const bend = Math.max(40, Math.abs(pendingLink.x - x1) * 0.45);
        return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${pendingLink.x - bend} ${pendingLink.y}, ${pendingLink.x} ${pendingLink.y}`;
      })()
    : null;

  // The stage grows with the nodes so nothing gets clipped at the edge.
  const stageWidth = Math.max(
    COLUMN.final + NODE_WIDTH + 80,
    ...Object.values(rects).map((rect) => rect.x + rect.w + 80)
  );
  const stageHeight = Math.max(
    canvasHeight,
    ...Object.values(rects).map((rect) => rect.y + rect.h + 80)
  );

  /**
   * Tidy the board: columns in pipeline order, each stack spaced by the measured
   * height of its cards rather than a fixed pitch, so a tall workbench does not
   * collide with the next one. The final cut centres on the shot column.
   */
  const autoArrange = () => {
    const GAP = 32;
    const TOP = 40;
    const heightOf = (id: string, fallback: number) => rects[id]?.h || fallback;

    const positions: Record<string, { x: number; y: number }> = {};

    positions.script = { x: COLUMN.script, y: TOP };
    positions.board = { x: COLUMN.board, y: TOP };

    const assetsHeight = heightOf('assets', 330);
    positions.assets = { x: COLUMN.assets, y: TOP };
    positions.params = { x: COLUMN.assets, y: TOP + assetsHeight + GAP };

    let y = TOP;
    for (const shot of doc.shots) {
      positions[shot.id] = { x: COLUMN.shots, y };
      y += heightOf(shot.id, 300) + GAP;
    }

    const shotStackHeight = Math.max(0, y - GAP - TOP);
    const finalHeight = heightOf('final', 150);
    // Centre the final cut on the shot column so the pipeline reads as one flow.
    positions.final = {
      x: COLUMN.final,
      y: TOP + Math.max(0, (shotStackHeight - finalHeight) / 2),
    };

    updateDoc((current) => ({ ...current, positions }));
  };

  const resetLayout = () =>
    updateDoc((current) => ({ ...current, positions: {} }));

  // Esc clears the selection, Ctrl/Cmd+A takes every workbench. Ignored while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (typing) return;

      if (event.key === 'Escape') {
        setSelectedIds([]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedIds(doc.shots.map((shot) => shot.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc.shots]);

  // Delete removes the selected workbenches. Ignored while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (selectedIds.length === 0) return;
      event.preventDefault();
      deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Ctrl/Cmd+Z is undo, Shift added redoes. Ignored while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [redo, undo]);

  // Markers for the minimap: the four fixed nodes plus every workbench.
  const markerFor = (id: string, tone: ViewportMarker['tone']): ViewportMarker => {
    const rect = rects[id];
    if (rect) return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, tone };
    const fallback = posOf(id, defaultPos(id));
    return { x: fallback.x, y: fallback.y, w: NODE_WIDTH, h: 200, tone };
  };

  const markers: ViewportMarker[] = [
    markerFor('script', 'node'),
    markerFor('board', 'node'),
    markerFor('assets', 'node'),
    markerFor('params', 'node'),
    markerFor('final', 'node'),
    ...doc.shots.map((shot) => markerFor(shot.id, 'shot')),
  ];

  return (
    <DramaViewport
      contentWidth={stageWidth}
      contentHeight={stageHeight}
      markers={markers}
      onScaleChange={(scale) => {
        viewScaleRef.current = scale;
      }}
      onResetLayout={resetLayout}
      onAutoArrange={autoArrange}
      onMarquee={onMarquee}
      apiRef={viewportApi}
      onUndo={undo}
      onRedo={redo}
      canUndo={historyState.canUndo}
      canRedo={historyState.canRedo}
    >
      <div className="relative" style={{ width: stageWidth, height: stageHeight }}>
        {/* Connectors follow the measured rects, so they track a dragged node. */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={stageWidth}
          height={stageHeight}
          aria-hidden="true"
        >
          <defs>
            <marker id="drama-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--beat-accent)" opacity="0.65" />
            </marker>
          </defs>
          {edges.map((edge, index) => (
            <path
              key={index}
              d={edge.path}
              fill="none"
              stroke="var(--beat-accent)"
              strokeOpacity={edge.strong ? 0.5 : 0.32}
              strokeWidth={edge.strong ? 1.6 : 1.4}
              markerEnd="url(#drama-arrow)"
            />
          ))}
        </svg>

        {/* Script */}
        <div
          ref={registerNode('script')}
          onPointerDown={startNodeDrag('script')}
          onPointerMove={moveNodeDrag}
          onPointerUp={endNodeDrag}
          onPointerCancel={endNodeDrag}
          className={cn(
            'pointer-events-auto absolute rounded-[16px]',
            selectedIds.includes('script') && 'ring-2 ring-[var(--beat-accent)]',
            draggingId === 'script' && 'z-30'
          )}
          style={{ ...posStyle('script') }}
        >
          <NodeShell
            title={m['drama.script.title']()}
            subtitle={doc.script ? m['drama.script.chars']({ count: doc.script.length }) : m['drama.script.empty']()}
            icon={<Clapperboard className="size-3.5" />}
            helpId="script"
            ports={{ onStartLink: beginLink('script') }}
          >
            <textarea
              value={doc.script}
              onChange={(e) =>
                updateDoc((current) => ({ ...current, script: e.target.value }))
              }
              placeholder={m['drama.script.placeholder']()}
              className="h-40 w-full resize-none rounded-[10px] border border-ink/[0.08] bg-ink/[0.03] px-2.5 py-2 text-[13px] leading-6 text-[var(--beat-text-1)] outline-none placeholder:text-ink/25 focus:border-ink/20"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => updateDoc((c) => ({ ...c, script: dramaTemplate() }))}
                className="rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2.5 py-1 text-[14px] text-[var(--beat-text-2)] transition hover:text-ink"
              >
                {m['drama.script.useTemplate']()}
              </button>
              <button
                type="button"
                onClick={splitScript}
                className="rounded-full bg-[var(--beat-accent)] px-2.5 py-1 text-[14px] font-medium text-white transition hover:opacity-90"
              >
                {m['drama.script.toBoard']()}
              </button>
            </div>
          </NodeShell>
        </div>

        {/* Storyboard */}
        <div
          ref={registerNode('board')}
          onPointerDown={startNodeDrag('board')}
          onPointerMove={moveNodeDrag}
          onPointerUp={endNodeDrag}
          onPointerCancel={endNodeDrag}
          className={cn(
            'pointer-events-auto absolute rounded-[16px]',
            selectedIds.includes('board') && 'ring-2 ring-[var(--beat-accent)]',
            draggingId === 'board' && 'z-30'
          )}
          style={{ ...posStyle('board') }}
        >
          <NodeShell
            title={m['drama.board.title']()}
            subtitle={m['drama.board.subtitle']({ segments: analysis.segments.length, assets: analysis.assets.length })}
            icon={<Layers className="size-3.5" />}
            helpId="board"
            ports={{ inputId: 'board', onStartLink: beginLink('board') }}
            accent
          >
            <div className="flex flex-col gap-1.5 text-[13px] text-[var(--beat-text-2)]">
              <div className="flex items-center justify-between rounded-[8px] bg-ink/[0.04] px-2 py-1.5">
                <span>{m['drama.board.segments']()}</span>
                <span className="tabular-nums">{analysis.segments.length}</span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-ink/[0.04] px-2 py-1.5">
                <span>{m['drama.board.assets']()}</span>
                <span className="tabular-nums">{analysis.assets.length}</span>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-ink/[0.04] px-2 py-1.5">
                <span>{m['drama.board.workbenches']()}</span>
                <span className="tabular-nums">{doc.shots.length}</span>
              </div>
            </div>
            <p className="mt-2 text-[13.5px] leading-6 text-[var(--beat-text-3)]">
              {m['drama.board.hint']()}
            </p>

            <button
              type="button"
              onClick={() => {
                // A producer wants something they can diff, not a screenshot
                window.open(`/api/app/projects/${projectId}/shotlist`, '_blank');
              }}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-ink/[0.12] py-1.5 text-[14px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink"
            >
              <Table2 className="size-3.5" />
              {m['drama.board.exportList']()}
            </button>
              <button
                type="button"
                onClick={() => ((doc.collapsedShots ?? []).length > 0 && (doc.collapsedShots ?? []).length === doc.shots.length ? expandAllShots() : collapseAllShots())}
                disabled={doc.shots.length === 0}
                className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-ink/[0.12] py-1.5 text-[14px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
              >
                {(doc.collapsedShots ?? []).length > 0 && (doc.collapsedShots ?? []).length === doc.shots.length ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                {(doc.collapsedShots ?? []).length > 0 && (doc.collapsedShots ?? []).length === doc.shots.length ? m['drama.board.expandAll']() : m['drama.board.collapseAll']()}
              </button>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="shrink-0 text-[13.5px] text-[var(--beat-text-3)]">{m['drama.board.batchSeconds']()}</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={batchSeconds}
                  onChange={(event) => setBatchSeconds(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
                  aria-label={m['drama.board.batchSeconds']()}
                  data-batch-seconds="true"
                  className="h-6 w-12 rounded-[6px] border border-ink/[0.1] bg-ink/[0.03] px-1.5 text-[14px] tabular-nums text-[var(--beat-text-1)] outline-none"
                />
                <button
                  type="button"
                  onClick={() => applySecondsToAll(batchSeconds)}
                  disabled={doc.shots.length === 0}
                  className="h-6 flex-1 rounded-[6px] border border-ink/[0.12] text-[13.5px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
                >
                  {m['drama.board.applyAll']({ count: doc.shots.length })}
                </button>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  value={batchAssetId}
                  onChange={(event) => setBatchAssetId(event.target.value)}
                  aria-label={m['drama.board.batchAsset']()}
                  data-batch-asset="true"
                  className="h-6 min-w-0 flex-1 rounded-[6px] border border-ink/[0.1] bg-ink/[0.03] px-1 text-[13.5px] text-[var(--beat-text-1)] outline-none"
                >
                  <option value="">{m['drama.board.batchAsset']()}</option>
                  {doc.publicAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!batchAssetId || doc.shots.length === 0}
                  onClick={() => {
                    if (!batchAssetId) return;
                    const everywhere = doc.shots.every((shot) => shot.publicAssetIds.includes(batchAssetId));
                    if (everywhere) removeAssetFromAll(batchAssetId);
                    else applyAssetToAll(batchAssetId);
                  }}
                  className="h-6 shrink-0 rounded-[6px] border border-ink/[0.12] px-1.5 text-[13.5px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink disabled:opacity-40"
                >
                  {batchAssetId && doc.shots.every((shot) => shot.publicAssetIds.includes(batchAssetId))
                    ? m['drama.board.removeAssetAll']({ count: doc.shots.length })
                    : m['drama.board.applyAssetAll']({ count: doc.shots.length })}
                </button>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="shrink-0 text-[13.5px] text-[var(--beat-text-3)]">{m['drama.board.promptPrefix']()}</span>
                <input
                  type="text"
                  value={doc.promptPrefix ?? ''}
                  onChange={(event) => updateDoc((current) => ({ ...current, promptPrefix: event.target.value }))}
                  placeholder={m['drama.board.promptPrefixHint']()}
                  aria-label={m['drama.board.promptPrefix']()}
                  data-prompt-prefix="true"
                  className="h-6 min-w-0 flex-1 rounded-[6px] border border-ink/[0.1] bg-ink/[0.03] px-1.5 text-[13.5px] text-[var(--beat-text-1)] outline-none placeholder:text-[var(--beat-text-3)]"
                />
              </div>
          </NodeShell>
        </div>

        {/* Assets */}
        <div
          ref={registerNode('assets')}
          onPointerDown={startNodeDrag('assets')}
          onPointerMove={moveNodeDrag}
          onPointerUp={endNodeDrag}
          onPointerCancel={endNodeDrag}
          className={cn(
            'pointer-events-auto absolute rounded-[16px]',
            selectedIds.includes('assets') && 'ring-2 ring-[var(--beat-accent)]',
            draggingId === 'assets' && 'z-30'
          )}
          style={{ ...posStyle('assets') }}
        >
          <NodeShell
            title={m['drama.assets.title']()}
            subtitle={m['drama.assets.subtitle']({ ready: doc.publicAssets.filter((a) => a.imageUrl).length, total: doc.publicAssets.length })}
            icon={<ImagePlus className="size-3.5" />}
            helpId="assets"
            ports={{ inputId: 'assets', onStartLink: beginLink('assets') }}
            accent
          >
            <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
              {doc.publicAssets.length === 0 ? (
                <p className="py-2 text-center text-[14px] text-[var(--beat-text-3)]">
                  {m['drama.assets.empty']()}
                </p>
              ) : (
                doc.publicAssets.map((asset) => {
                  const used = doc.shots.filter((s) => s.publicAssetIds.includes(asset.id)).length;
                  return (
                    <div
                      key={asset.id}
                      className="flex items-center gap-1.5 rounded-[8px] border border-ink/[0.07] bg-ink/[0.02] p-1"
                    >
                      <ImageHoverPreview src={asset.imageUrl} alt={asset.name}>
                        <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[5px] border border-ink/[0.1] bg-ink/[0.05]">
                          {asset.imageUrl ? (
                            <img src={asset.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <ImagePlus className="size-4 text-[var(--beat-text-3)]" />
                          )}
                        </span>
                      </ImageHoverPreview>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[14px] text-[var(--beat-text-1)]">
                          {ASSET_KIND_LABELS[asset.kind]?.slice(0, 1)} · {asset.name}
                        </span>
                        <span className="truncate text-[13px] text-[var(--beat-text-3)]">
                          {m['drama.assets.usedIn']({ count: used })}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPublicUploadTarget(asset.id);
                          requestAnimationFrame(() => publicFileRef.current?.click());
                        }}
                        className="rounded-full border border-ink/[0.1] px-1.5 py-0.5 text-[13px] text-[var(--beat-text-2)] hover:text-ink"
                      >
                        {m['drama.assets.replace']()}
                      </button>
                        <CastLibraryButton
                          projectId={projectId}
                          sourceAssetId={asset.imageUrl?.match(/\/assets\/([0-9a-f-]{36})/i)?.[1] ?? ''}
                          assetName={asset.name}
                          hasImage={!!asset.imageUrl}
                          onPicked={(url: string) => setAssetImage(asset.id, url)}
                        />
                    </div>
                  );
                })
              )}
            </div>
            <input
              ref={publicFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                const target = publicUploadTarget;
                e.currentTarget.value = '';
                setPublicUploadTarget(null);
                if (file && target) uploadPublicImage(target, file);
              }}
            />
          </NodeShell>
        </div>

        {/* Parameters */}
        <div
          ref={registerNode('params')}
          onPointerDown={startNodeDrag('params')}
          onPointerMove={moveNodeDrag}
          onPointerUp={endNodeDrag}
          onPointerCancel={endNodeDrag}
          className={cn(
            'pointer-events-auto absolute rounded-[16px]',
            selectedIds.includes('params') && 'ring-2 ring-[var(--beat-accent)]',
            draggingId === 'params' && 'z-30'
          )}
          style={{ ...posStyle('params') }}
        >
          <NodeShell
            title={m['drama.params.title']()}
            subtitle={m['drama.params.subtitle']({
              resolution: String(doc.params.resolution ?? m['drama.params.auto']()),
              loras: activeDramaLoras().length,
            })}
            icon={<Sliders className="size-3.5" />}
            helpId="params"
          >
            <div className="flex max-h-[340px] flex-col gap-2 overflow-y-auto pr-1">
              {(['output', 'motion', 'sampling', 'memory'] as const).map((group) => (
                <div key={group} className="flex flex-col gap-1">
                  <span className="text-[13px] uppercase tracking-wider text-[var(--beat-text-3)]">
                    {DIRECTOR_GROUP_LABELS[group]}
                  </span>
                  {DIRECTOR_FIELDS.filter((field) => field.group === group).map((field) => {
                    const current = doc.params[field.key] ?? field.default;
                    if (field.type === 'boolean') {
                      return (
                        <label key={field.key} className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13.5px] text-[var(--beat-text-2)]">
                            {field.label}
                          </span>
                          <input
                            type="checkbox"
                            checked={current === true}
                            onChange={(event) => setParam(field.key, event.target.checked)}
                            className="size-4 shrink-0"
                          />
                        </label>
                      );
                    }
                    if (field.type === 'number') {
                      return (
                        <label key={field.key} className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13.5px] text-[var(--beat-text-2)]">
                            {field.label}
                          </span>
                          <input
                            type="number"
                            value={Number(current)}
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            onChange={(event) =>
                              setParam(field.key, Number(event.target.value) || 0)
                            }
                            className="w-[62px] shrink-0 rounded-[5px] border border-ink/[0.08] bg-ink/[0.03] px-1 py-0.5 text-right text-[13.5px] text-[var(--beat-text-1)] outline-none focus:border-ink/20"
                          />
                        </label>
                      );
                    }
                    return (
                      <label key={field.key} className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] text-[var(--beat-text-2)]">
                          {field.label}
                        </span>
                        <select
                          value={String(current)}
                          onChange={(event) => setParam(field.key, event.target.value)}
                          className="w-[104px] shrink-0 rounded-[5px] border border-ink/[0.08] bg-ink/[0.03] px-1 py-0.5 text-[13.5px] text-[var(--beat-text-1)] outline-none focus:border-ink/20"
                        >
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              ))}

              <div className="flex flex-col gap-1 border-t border-ink/[0.08] pt-1.5">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[13px] uppercase tracking-wider text-[var(--beat-text-3)]">
                    {m['drama.enhance.title']()}
                  </span>
                  <input
                    type="checkbox"
                    checked={doc.enhance.enabled}
                    onChange={(event) =>
                      setDoc((current) => ({
                        ...current,
                        enhance: { ...current.enhance, enabled: event.target.checked },
                      }))
                    }
                    className="size-3.5"
                  />
                </label>
                {doc.enhance.enabled ? (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {ENHANCE_RULES.map((rule) => {
                        const active = doc.enhance.rules.includes(rule.id);
                        return (
                          <button
                            key={rule.id}
                            type="button"
                            title={rule.text}
                            onClick={() =>
                              setDoc((current) => ({
                                ...current,
                                enhance: {
                                  ...current.enhance,
                                  rules: active
                                    ? current.enhance.rules.filter((id: EnhanceRuleId) => id !== rule.id)
                                    : [...current.enhance.rules, rule.id],
                                },
                              }))
                            }
                            className={cn(
                              'rounded-full border px-1.5 py-0.5 text-[13px] transition',
                              active
                                ? 'border-[var(--beat-accent)]/50 bg-[var(--beat-accent)]/12 text-[var(--beat-accent)]'
                                : 'border-ink/[0.12] text-[var(--beat-text-2)] hover:border-ink/25 hover:text-ink'
                            )}
                          >
                            {ENHANCE_LABELS[rule.id]()}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      value={doc.enhance.extra}
                      onChange={(event) =>
                        setDoc((current) => ({
                          ...current,
                          enhance: { ...current.enhance, extra: event.target.value },
                        }))
                      }
                      placeholder={m['drama.enhance.extraPlaceholder']()}
                      className="w-full rounded-[5px] border border-ink/[0.08] bg-ink/[0.03] px-1.5 py-1 text-[9.5px] text-[var(--beat-text-1)] outline-none focus:border-ink/25"
                    />
                  </>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[13px] uppercase tracking-wider text-[var(--beat-text-3)]">
                  LoRA
                </span>
                {Array.from({ length: 3 }, (_, index) => {
                  const entry = doc.loras[index] ?? { file: 'none', strength: 1 };
                  return (
                    <div key={index} className="flex items-center gap-1">
                      <select
                        value={entry.file}
                        onChange={(event) => setLora(index, { file: event.target.value })}
                        className="min-w-0 flex-1 rounded-[5px] border border-ink/[0.08] bg-ink/[0.03] px-1 py-0.5 text-[13px] text-[var(--beat-text-1)] outline-none"
                      >
                        {COMMON_LORAS.map((file) => (
                          <option key={file} value={file}>
                            {file === 'none' ? 'none' : file.split('\\').pop()?.replace('.safetensors', '')}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={entry.strength}
                        min={-4}
                        max={4}
                        step={0.05}
                        onChange={(event) =>
                          setLora(index, { strength: Number(event.target.value) })
                        }
                        className="w-11 shrink-0 rounded-[5px] border border-ink/[0.08] bg-ink/[0.03] px-1 py-0.5 text-right text-[13px] outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </NodeShell>
        </div>

        {/* Segment workbenches */}
        {doc.shots.map((shot, index) => (
          <div
            key={shot.id}
            ref={registerNode(shot.id)}
            onPointerDown={startNodeDrag(shot.id)}
            onPointerMove={moveNodeDrag}
            onPointerUp={endNodeDrag}
            onPointerCancel={endNodeDrag}
            className={cn(
            'pointer-events-auto absolute rounded-[16px]',
            selectedIds.includes(shot.id) && 'ring-2 ring-[var(--beat-accent)]',
            draggingId === shot.id && 'z-30'
          )}
            style={{ ...posStyle(shot.id) }}
          >
            <NodeShell
              title={m['drama.shot.title']({ index: index + 1 })}
              collapsed={isShotCollapsed(shot.id)}
              onToggleCollapse={() => toggleShotCollapsed(shot.id)}
              subtitle={`${shot.seconds}s · ${shotStatusLabel(shot.status)}`}
              icon={<Film className="size-3.5" />}
              helpId="shot"
              ports={{ inputId: shot.id, onStartLink: beginLink(shot.id) }}
            >
              <textarea
                value={shot.prompt}
                onChange={(e) => setShot(shot.id, { prompt: e.target.value })}
                placeholder={m['drama.shot.placeholder']()}
                className="h-16 w-full resize-none rounded-[8px] border border-ink/[0.08] bg-ink/[0.03] px-2 py-1.5 text-[13px] leading-6 text-[var(--beat-text-1)] outline-none placeholder:text-ink/25 focus:border-ink/20"
              />
              {!usesSharedAssets(shot.id) ? (
                <p className="mt-1 text-[13px] text-[var(--beat-text-3)]">
                  {m['drama.wire.detached']()}
                </p>
              ) : null}
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="number"
                  min={0.2}
                  max={30}
                  step={0.5}
                  value={shot.seconds}
                  onChange={(e) => setShot(shot.id, { seconds: Number(e.target.value) || 3 })}
                  className="w-14 rounded-[6px] border border-ink/[0.07] bg-ink/[0.03] px-1.5 py-0.5 text-right text-[14px] text-[var(--beat-text-1)] outline-none"
                />
                <span className="text-[13px] text-[var(--beat-text-3)]">{m['drama.shot.seconds']()}</span>
                <span className="ml-auto text-[13px] text-[var(--beat-text-3)]">
                  {m['drama.shot.refs']({ count: resolveImages(shot).length })}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {doc.publicAssets.map((asset) => {
                  const on = shot.publicAssetIds.includes(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() =>
                        setShot(shot.id, {
                          publicAssetIds: on
                            ? shot.publicAssetIds.filter((id) => id !== asset.id)
                            : [...shot.publicAssetIds, asset.id],
                        })
                      }
                      className={cn(
                        'max-w-[92px] truncate rounded-full border px-1.5 py-0.5 text-[13px] transition',
                        on
                          ? 'border-[var(--beat-accent)]/50 bg-[var(--beat-accent)]/15 text-[var(--beat-accent)]'
                          : 'border-ink/[0.1] text-[var(--beat-text-3)] hover:text-ink'
                      )}
                    >
                      {asset.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setShotUploadTarget(shot.id);
                    requestAnimationFrame(() => shotFileRef.current?.click());
                  }}
                  className="rounded-full border border-dashed border-ink/[0.15] px-1.5 py-0.5 text-[13px] text-[var(--beat-text-3)] hover:text-ink"
                >
                  {m['drama.shot.upload']()}
                </button>
              </div>

              {/* Per-shot assets: images that belong to this shot only. */}
              <div className="mt-1.5 rounded-[8px] border border-ink/[0.07] bg-ink/[0.02] p-1.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] text-[var(--beat-text-3)]">
                    {m['drama.shot.assets']()}
                  </span>
                  <span className="text-[13px] tabular-nums text-[var(--beat-text-3)]">
                    {shot.ownImageUrls.length}
                  </span>
                </div>
                {shot.ownImageUrls.length === 0 ? (
                  <p className="text-[13px] text-[var(--beat-text-3)]/75">
                    {m['drama.shot.assetsEmpty']()}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {shot.ownImageUrls.map((url) => (
                      <ImageHoverPreview key={url} src={url} previewWidth={260} previewHeight={260}>
                        <span className="group/own relative block size-8 overflow-hidden rounded-[5px] border border-ink/[0.12]">
                          <img src={url} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() =>
                              setShot(shot.id, {
                                ownImageUrls: shot.ownImageUrls.filter((u) => u !== url),
                              })
                            }
                            aria-label={m['drama.shot.assetRemove']()}
                            className="absolute inset-0 grid place-items-center bg-black/60 text-[13px] text-white opacity-0 transition group-hover/own:opacity-100"
                          >
                            ×
                          </button>
                        </span>
                      </ImageHoverPreview>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busyShot === shot.id}
                  onClick={() => void generateShot(shot)}
                  className="flex-1 rounded-[8px] bg-[var(--beat-accent)] py-1 text-[14px] font-medium text-white transition hover:opacity-90 disabled:opacity-45"
                >
                  {busyShot === shot.id ? m['drama.shot.generating']() : m['drama.shot.generate']()}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateDoc((current) => ({
                      ...current,
                      shots: current.shots.filter((s) => s.id !== shot.id),
                    }))
                  }
                  className="grid size-6 place-items-center rounded-[6px] text-[var(--beat-text-3)] hover:bg-ink/[0.07] hover:text-ink"
                  aria-label={m['drama.shot.remove']()}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {shot.error
                ? (() => {
                    const kind = classifyGenerationFailure(shot.error);
                    return (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <p className="text-[13px] font-medium text-red-400">
                          {FAILURE_LABELS[kind]()}
                          <span className="ml-1 font-normal text-[var(--beat-text-3)]">
                            {FAILURE_HINTS[kind]()}
                          </span>
                        </p>
                        <p className="line-clamp-2 text-[8.5px] text-[var(--beat-text-3)]">{shot.error}</p>
                      </div>
                    );
                  })()
                : null}
              {(() => {
                const versions = shot.versions ?? [];
                if (versions.length === 0) return null;
                const previewIndex = Math.min(previewVersion[shot.id] ?? 0, versions.length - 1);
                const shown = versions[previewIndex];
                const adoptedIndex = versions.findIndex((v) => v.url === shot.videoUrl);
                const isAdopted = adoptedIndex === previewIndex;
                return (
                  <>
                    <video src={shown.url} controls className="mt-1.5 w-full rounded-[6px]" />
                    {versions.length > 1 ? (
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={m['drama.version.prev']()}
                          onClick={() =>
                            setPreviewVersion((current) => ({
                              ...current,
                              [shot.id]: (previewIndex - 1 + versions.length) % versions.length,
                            }))
                          }
                          className="grid size-5 place-items-center rounded-[5px] border border-ink/[0.12] text-[13.5px] text-[var(--beat-text-2)] transition hover:border-ink/30 hover:text-ink"
                        >
                          ‹
                        </button>
                        <span className="tabular-nums text-[9.5px] text-[var(--beat-text-2)]">
                          {m['drama.version.counter']({ index: previewIndex + 1, total: versions.length })}
                        </span>
                        <button
                          type="button"
                          aria-label={m['drama.version.next']()}
                          onClick={() =>
                            setPreviewVersion((current) => ({
                              ...current,
                              [shot.id]: (previewIndex + 1) % versions.length,
                            }))
                          }
                          className="grid size-5 place-items-center rounded-[5px] border border-ink/[0.12] text-[13.5px] text-[var(--beat-text-2)] transition hover:border-ink/30 hover:text-ink"
                        >
                          ›
                        </button>
                        <button
                          type="button"
                          disabled={isAdopted}
                          onClick={() => adoptVersion(shot.id, shown.id)}
                          className="ml-auto rounded-[5px] px-1.5 py-0.5 text-[13px] text-[var(--beat-accent)] transition hover:bg-[var(--beat-accent)]/10 disabled:text-[var(--beat-text-3)] disabled:hover:bg-transparent"
                        >
                          {isAdopted ? m['drama.version.adopted']() : m['drama.version.adopt']()}
                        </button>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </NodeShell>
          </div>
        ))}

        {/* Add a segment */}
        <div className="pointer-events-auto absolute" style={{ left: COLUMN.shots, top: shotY(doc.shots.length) }}>
          <button
            type="button"
            onClick={addShot}
            style={{ width: NODE_WIDTH }}
            className="flex items-center justify-center gap-1 rounded-[12px] border border-dashed border-ink/[0.15] py-2 text-[13px] text-[var(--beat-text-2)] transition hover:border-ink/30 hover:text-ink"
          >
            <Plus className="size-3.5" />
            {m['drama.add']()}
          </button>
        </div>

        {/* Final video stage */}
        <div
          ref={registerNode('final')}
          onPointerDown={startNodeDrag('final')}
          onPointerMove={moveNodeDrag}
          onPointerUp={endNodeDrag}
          onPointerCancel={endNodeDrag}
          className={cn(
            'pointer-events-auto absolute rounded-[16px]',
            selectedIds.includes('final') && 'ring-2 ring-[var(--beat-accent)]',
            draggingId === 'final' && 'z-30'
          )}
          style={{ ...posStyle('final') }}
        >
          <NodeShell
            title={m['drama.final.title']()}
            subtitle={m['drama.final.subtitle']({ shots: doc.shots.length, seconds: Math.round(grandTotal) })}
            icon={<Sparkles className="size-3.5" />}
            helpId="final"
            ports={{ inputId: 'final' }}
            accent
          >
            <p className="mb-2 text-[13.5px] leading-6 text-[var(--beat-text-3)]">
              {m['drama.final.hint']()}
            </p>
            <button
              type="button"
              disabled={doc.shots.length === 0 || doc.finalStatus === 'running'}
              onClick={() => void generateFinal()}
              className="flex w-full items-center justify-center gap-1.5 rounded-[8px] bg-[var(--beat-accent)] py-1.5 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-45"
            >
              <Wand2 className="size-3.5" />
              {doc.finalStatus === 'running' ? m['drama.final.running']() : m['drama.final.run']()}
            </button>
            {doc.finalStatus === 'failed' ? (
              <p className="mt-1.5 text-[13px] text-red-400">{doc.finalError ?? m['drama.final.failed']()}</p>
            ) : null}
            <div className="mt-2 flex flex-col gap-1.5">
              <label className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] text-[var(--beat-text-2)]">
                  {m['drama.final.preset']()}
                </span>
                <select
                  value={doc.exportPreset}
                  onChange={(event) =>
                    setDoc((current) => ({
                      ...current,
                      exportPreset: event.target.value,
                    }))
                  }
                  className="w-[132px] rounded-[5px] border border-ink/[0.1] bg-ink/[0.03] px-1 py-0.5 text-[9.5px] text-[var(--beat-text-1)] outline-none focus:border-ink/25"
                >
                  {(Object.keys(EXPORT_PRESETS) as ExportPresetId[]).map((id) => (
                    <option key={id} value={id}>
                      {PRESET_LABELS[id]()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] text-[var(--beat-text-2)]">
                  {m['drama.final.subtitles']()}
                </span>
                <input
                  type="checkbox"
                  checked={doc.subtitles}
                  onChange={(event) =>
                    setDoc((current) => ({ ...current, subtitles: event.target.checked }))
                  }
                  className="size-3.5"
                />
              </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] text-[var(--beat-text-2)]">
                    {m['drama.final.attachList']()}
                  </span>
                  <input
                    type="checkbox"
                    data-attach-shotlist="true"
                    checked={doc.attachShotList !== false}
                    onChange={(event) =>
                      setDoc((current) => ({ ...current, attachShotList: event.target.checked }))
                    }
                    className="size-3.5"
                  />
                </label>

              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] text-[var(--beat-text-2)]">
                  {doc.bgmName ?? m['drama.final.bgmNone']()}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => bgmFileRef.current?.click()}
                    className="rounded-[5px] border border-ink/[0.12] px-1.5 py-0.5 text-[13px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink"
                  >
                    {m['drama.final.bgmPick']()}
                  </button>
                  {doc.bgmAssetId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDoc((current) => ({
                          ...current,
                          bgmAssetId: null,
                          bgmName: null,
                        }))
                      }
                      className="rounded-[5px] px-1 py-0.5 text-[13px] text-[var(--beat-text-3)] transition hover:text-ink"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>

              {doc.bgmAssetId ? (
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] text-[var(--beat-text-2)]">
                    {m['drama.final.bgmVolume']()}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={doc.bgmVolume}
                    onChange={(event) =>
                      setDoc((current) => ({
                        ...current,
                        bgmVolume: Number(event.target.value),
                      }))
                    }
                    className="w-[92px]"
                  />
                </label>
              ) : null}
            </div>

            {pipeline.running ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="flex-1 text-[13.5px] tabular-nums text-[var(--beat-accent)]">
                  {m['drama.final.progress']({
                    done: pipeline.done + 1,
                    total: pipeline.total,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    stopPipelineRef.current = true;
                  }}
                  className="rounded-[6px] border border-ink/[0.14] px-2 py-0.5 text-[13.5px] text-[var(--beat-text-2)] transition hover:border-ink/30 hover:text-ink"
                >
                  {m['drama.final.stop']()}
                </button>
              </div>
            ) : pendingShots().length > 0 ? (
              <button
                type="button"
                onClick={() => void runPipeline({ retry: true })}
                className="mt-1.5 w-full rounded-[8px] bg-[var(--beat-accent)] py-1.5 text-[14px] font-medium text-white transition hover:opacity-90"
              >
                {doc.shots.some((s) => isInFinal(s.id) && s.status === 'failed')
                  ? m['drama.final.rerun']()
                  : m['drama.final.resume']({ count: pendingShots().length })}
              </button>
            ) : doc.shots.length > 0 ? (
              <p className="mt-1.5 text-[13.5px] text-[var(--beat-text-3)]">
                {m['drama.final.allDone']({ count: doc.shots.length })}
              </p>
            ) : null}

            {null}
            <button
              type="button"
              onClick={autoWire}
              className="mt-1.5 w-full rounded-[8px] border border-ink/[0.12] py-1 text-[14px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink"
            >
              {m['drama.wire.auto']()}
            </button>
            <p className="mt-1.5 text-[13px] leading-6 text-[var(--beat-text-3)]">
              {m['drama.wire.hint']({ count: doc.links.length })}
            </p>
            {doc.finalVideoUrl ? (
              <button
                type="button"
                onClick={() => void sendToEditor()}
                className="mt-1.5 w-full rounded-[8px] border border-ink/[0.14] py-1 text-[14px] text-[var(--beat-text-2)] transition hover:border-ink/30 hover:text-ink"
              >
                {m['drama.final.toEditor']()}
              </button>
            ) : null}
            {doc.finalVideoUrl ? (
              <>
              <video src={doc.finalVideoUrl} controls className="mt-2 w-full rounded-[8px]" />
              {doc.attachShotList !== false ? (
                <a
                  href={`/api/app/projects/${projectId}/shotlist`}
                  target="_blank"
                  rel="noreferrer"
                  data-shotlist-download="true"
                  className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-ink/[0.12] py-1 text-[14px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink"
                >
                  <Table2 className="size-3.5" />
                  {m['drama.final.downloadList']()}
                </a>
              ) : null}
              </>
            ) : null}
          </NodeShell>
        </div>
      </div>

      <input
        ref={bgmFileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = '';
          if (file) void uploadBgm(file);
        }}
      />
      <input
        ref={shotFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = shotUploadTarget;
          e.currentTarget.value = '';
          setShotUploadTarget(null);
          if (file && target) uploadShotImage(target, file);
        }}
      />
    </DramaViewport>
  );
}

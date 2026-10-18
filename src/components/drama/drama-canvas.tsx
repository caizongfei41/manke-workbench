import {
  Clapperboard,
  Film,
  ImagePlus,
  Layers,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageHoverPreview } from '@/components/app/image-hover-preview';
import { DramaViewport, type ViewportMarker } from '@/components/drama/drama-viewport';
import { HintTip } from '@/components/app/hint-tip';
import {
  DRAMA_ASPECT_RATIO,
  DRAMA_GLOBAL,
  DRAMA_MODEL_ID,
  analyzeScript,
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
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      style={{ width }}
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
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[12px] font-medium leading-none text-[var(--beat-text-1)]">
            {title}
          </span>
          {subtitle ? (
            <span className="mt-1 truncate text-[10px] leading-none text-[var(--beat-text-3)]">
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export function DramaCanvas({ projectId, initialDocument, onPersist }: Props) {
  const [doc, setDoc] = useState<DramaDocument>(() => loadDramaDocument(initialDocument));
  const [busyShot, setBusyShot] = useState<string | null>(null);
  const shotFileRef = useRef<HTMLInputElement | null>(null);
  const [shotUploadTarget, setShotUploadTarget] = useState<string | null>(null);
  const publicFileRef = useRef<HTMLInputElement | null>(null);
  const [publicUploadTarget, setPublicUploadTarget] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const registerNode = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) nodeRefs.current.set(id, el);
      else nodeRefs.current.delete(id);
      requestAnimationFrame(measure);
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
    setDoc((current) => ({
      ...current,
      positions: {
        ...current.positions,
        [drag.id]: {
          x: Math.round(drag.originX + dx / k),
          y: Math.round(drag.originY + dy / k),
        },
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
  const grandTotal = totalSeconds(doc.shots);

  const setShot = useCallback((id: string, patch: Partial<DramaShot>) => {
    setDoc((current) => ({
      ...current,
      shots: current.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
    }));
  }, []);

  const splitScript = () => {
    const shots = buildShotsFromScript(doc.script);
    setDoc((current) => ({
      ...current,
      shots,
      publicAssets:
        current.publicAssets.length > 0 ? current.publicAssets : analysis.assets,
    }));
  };

  const addShot = () => {
    setDoc((current) => ({
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
  const resolveShotRefs = (shot: DramaShot): ResolvedRef[] => {
    const order: Record<string, number> = { character: 0, scene: 1, prop: 2 };
    const picked = shot.publicAssetIds
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
        setDoc((current) => ({
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
        setDoc((current) => ({
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

  const generateShot = async (shot: DramaShot) => {
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
            prompt: shot.prompt || 'short drama shot',
            references: [],
            parameters: {
              aspect_ratio: DRAMA_ASPECT_RATIO,
              wmDuration: '12s',
              wmOutputQuality: '480p',
              director_global: { ...DRAMA_GLOBAL },
              director_segments: [
                {
                  prompt: shot.prompt,
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
          setShot(shot.id, {
            status: 'succeeded',
            videoUrl: item?.resultUrl ?? null,
          });
          break;
        }
        if (status?.status === 'failed') {
          setShot(shot.id, {
            status: 'failed',
            error: String(status.error ?? m['drama.error.failed']()),
          });
          break;
        }
      }
    } catch (error) {
      setShot(shot.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : m['drama.error.failed'](),
      });
    } finally {
      setBusyShot(null);
    }
  };

  const generateFinal = async () => {
    setDoc((current) => ({ ...current, finalStatus: 'running' }));
    try {
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
            prompt: doc.shots[0]?.prompt || 'short drama',
            references: [],
            parameters: {
              aspect_ratio: DRAMA_ASPECT_RATIO,
              wmDuration: '12s',
              wmOutputQuality: '480p',
              director_global: { ...DRAMA_GLOBAL },
              director_segments: doc.shots.map((shot) => ({
                prompt: shot.prompt,
                seconds: shot.seconds,
                imageUrls: resolveImages(shot),
                refs: resolveRefs(shot),
              })),
            },
          },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const wmTaskId = json?.wmTaskId;
      for (let i = 0; i < 400; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        const status = await fetch(`/api/effects/status?wmTaskId=${wmTaskId}`).then((r) =>
          r.json()
        );
        if (status?.status === 'succeeded') {
          const gens = await fetch(`/api/app/projects/${projectId}/generations`).then((r) =>
            r.json()
          );
          const item = (gens.items ?? []).find((g: { id: string }) => g.id === wmTaskId);
          setDoc((current) => ({
            ...current,
            finalStatus: 'succeeded',
            finalVideoUrl: item?.resultUrl ?? null,
          }));
          break;
        }
        if (status?.status === 'failed') {
          setDoc((current) => ({ ...current, finalStatus: 'failed' }));
          break;
        }
      }
    } catch {
      setDoc((current) => ({ ...current, finalStatus: 'failed' }));
    }
  };

  const shotY = (index: number) => 150 + index * SHOT_PITCH;
  const canvasHeight = Math.max(760, shotY(doc.shots.length) + 60);

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

  const edges = [
    { path: edgeFor('script', 'board'), strong: true },
    { path: edgeFor('board', 'assets'), strong: true },
    ...doc.shots.map((shot) => ({ path: edgeFor('assets', shot.id), strong: false })),
    ...doc.shots.map((shot) => ({ path: edgeFor(shot.id, 'final'), strong: false })),
  ].filter((edge): edge is { path: string; strong: boolean } => !!edge.path);

  // The stage grows with the nodes so nothing gets clipped at the edge.
  const stageWidth = Math.max(
    COLUMN.final + NODE_WIDTH + 80,
    ...Object.values(rects).map((rect) => rect.x + rect.w + 80)
  );
  const stageHeight = Math.max(
    canvasHeight,
    ...Object.values(rects).map((rect) => rect.y + rect.h + 80)
  );

  const resetLayout = () =>
    setDoc((current) => ({ ...current, positions: {} }));

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
            'pointer-events-auto absolute',
            draggingId === 'script' && 'z-30'
          )}
          style={{ ...posStyle('script') }}
        >
          <NodeShell
            title={m['drama.script.title']()}
            subtitle={doc.script ? m['drama.script.chars']({ count: doc.script.length }) : m['drama.script.empty']()}
            icon={<Clapperboard className="size-3.5" />}
          >
            <textarea
              value={doc.script}
              onChange={(e) =>
                setDoc((current) => ({ ...current, script: e.target.value }))
              }
              placeholder={m['drama.script.placeholder']()}
              className="h-40 w-full resize-none rounded-[10px] border border-ink/[0.08] bg-ink/[0.03] px-2.5 py-2 text-[11.5px] leading-5 text-[var(--beat-text-1)] outline-none placeholder:text-ink/25 focus:border-ink/20"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDoc((c) => ({ ...c, script: dramaTemplate() }))}
                className="rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2.5 py-1 text-[10.5px] text-[var(--beat-text-2)] transition hover:text-ink"
              >
                {m['drama.script.useTemplate']()}
              </button>
              <button
                type="button"
                onClick={splitScript}
                className="rounded-full bg-[var(--beat-accent)] px-2.5 py-1 text-[10.5px] font-medium text-white transition hover:opacity-90"
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
          className={cn('pointer-events-auto absolute', draggingId === 'board' && 'z-30')}
          style={{ ...posStyle('board') }}
        >
          <NodeShell
            title={m['drama.board.title']()}
            subtitle={m['drama.board.subtitle']({ segments: analysis.segments.length, assets: analysis.assets.length })}
            icon={<Layers className="size-3.5" />}
            accent
          >
            <div className="flex flex-col gap-1.5 text-[11px] text-[var(--beat-text-2)]">
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
            <p className="mt-2 text-[10px] leading-4 text-[var(--beat-text-3)]">
              {m['drama.board.hint']()}
            </p>
          </NodeShell>
        </div>

        {/* Assets */}
        <div
          ref={registerNode('assets')}
          onPointerDown={startNodeDrag('assets')}
          onPointerMove={moveNodeDrag}
          onPointerUp={endNodeDrag}
          onPointerCancel={endNodeDrag}
          className={cn('pointer-events-auto absolute', draggingId === 'assets' && 'z-30')}
          style={{ ...posStyle('assets') }}
        >
          <NodeShell
            title={m['drama.assets.title']()}
            subtitle={m['drama.assets.subtitle']({ ready: doc.publicAssets.filter((a) => a.imageUrl).length, total: doc.publicAssets.length })}
            icon={<ImagePlus className="size-3.5" />}
            accent
          >
            <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
              {doc.publicAssets.length === 0 ? (
                <p className="py-2 text-center text-[10.5px] text-[var(--beat-text-3)]">
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
                            <ImagePlus className="size-3 text-[var(--beat-text-3)]" />
                          )}
                        </span>
                      </ImageHoverPreview>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[10.5px] text-[var(--beat-text-1)]">
                          {ASSET_KIND_LABELS[asset.kind]?.slice(0, 1)} · {asset.name}
                        </span>
                        <span className="truncate text-[9px] text-[var(--beat-text-3)]">
                          {m['drama.assets.usedIn']({ count: used })}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPublicUploadTarget(asset.id);
                          requestAnimationFrame(() => publicFileRef.current?.click());
                        }}
                        className="rounded-full border border-ink/[0.1] px-1.5 py-0.5 text-[9px] text-[var(--beat-text-2)] hover:text-ink"
                      >
                        {m['drama.assets.replace']()}
                      </button>
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

        {/* Segment workbenches */}
        {doc.shots.map((shot, index) => (
          <div
            key={shot.id}
            ref={registerNode(shot.id)}
            onPointerDown={startNodeDrag(shot.id)}
            onPointerMove={moveNodeDrag}
            onPointerUp={endNodeDrag}
            onPointerCancel={endNodeDrag}
            className={cn('pointer-events-auto absolute', draggingId === shot.id && 'z-30')}
            style={{ ...posStyle(shot.id) }}
          >
            <NodeShell
              title={m['drama.shot.title']({ index: index + 1 })}
              subtitle={`${shot.seconds}s · ${shotStatusLabel(shot.status)}`}
              icon={<Film className="size-3.5" />}
            >
              <textarea
                value={shot.prompt}
                onChange={(e) => setShot(shot.id, { prompt: e.target.value })}
                placeholder={m['drama.shot.placeholder']()}
                className="h-16 w-full resize-none rounded-[8px] border border-ink/[0.08] bg-ink/[0.03] px-2 py-1.5 text-[11px] leading-4 text-[var(--beat-text-1)] outline-none placeholder:text-ink/25 focus:border-ink/20"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="number"
                  min={0.2}
                  max={30}
                  step={0.5}
                  value={shot.seconds}
                  onChange={(e) => setShot(shot.id, { seconds: Number(e.target.value) || 3 })}
                  className="w-14 rounded-[6px] border border-ink/[0.07] bg-ink/[0.03] px-1.5 py-0.5 text-right text-[10.5px] text-[var(--beat-text-1)] outline-none"
                />
                <span className="text-[9px] text-[var(--beat-text-3)]">{m['drama.shot.seconds']()}</span>
                <span className="ml-auto text-[9px] text-[var(--beat-text-3)]">
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
                        'max-w-[92px] truncate rounded-full border px-1.5 py-0.5 text-[9px] transition',
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
                  className="rounded-full border border-dashed border-ink/[0.15] px-1.5 py-0.5 text-[9px] text-[var(--beat-text-3)] hover:text-ink"
                >
                  {m['drama.shot.upload']()}
                </button>
              </div>

              {/* Per-shot assets: images that belong to this shot only. */}
              <div className="mt-1.5 rounded-[8px] border border-ink/[0.07] bg-ink/[0.02] p-1.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[9px] text-[var(--beat-text-3)]">
                    {m['drama.shot.assets']()}
                  </span>
                  <span className="text-[9px] tabular-nums text-[var(--beat-text-3)]">
                    {shot.ownImageUrls.length}
                  </span>
                </div>
                {shot.ownImageUrls.length === 0 ? (
                  <p className="text-[9px] text-[var(--beat-text-3)]/75">
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
                            className="absolute inset-0 grid place-items-center bg-black/60 text-[11px] text-white opacity-0 transition group-hover/own:opacity-100"
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
                  className="flex-1 rounded-[8px] bg-[var(--beat-accent)] py-1 text-[10.5px] font-medium text-white transition hover:opacity-90 disabled:opacity-45"
                >
                  {busyShot === shot.id ? m['drama.shot.generating']() : m['drama.shot.generate']()}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDoc((current) => ({
                      ...current,
                      shots: current.shots.filter((s) => s.id !== shot.id),
                    }))
                  }
                  className="grid size-6 place-items-center rounded-[6px] text-[var(--beat-text-3)] hover:bg-ink/[0.07] hover:text-ink"
                  aria-label={m['drama.shot.remove']()}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              {shot.error ? (
                <p className="mt-1 line-clamp-2 text-[9px] text-red-400">{shot.error}</p>
              ) : null}
              {shot.videoUrl ? (
                <video
                  src={shot.videoUrl}
                  controls
                  className="mt-1.5 w-full rounded-[6px]"
                />
              ) : null}
            </NodeShell>
          </div>
        ))}

        {/* Add a segment */}
        <div className="pointer-events-auto absolute" style={{ left: COLUMN.shots, top: shotY(doc.shots.length) }}>
          <button
            type="button"
            onClick={addShot}
            style={{ width: NODE_WIDTH }}
            className="flex items-center justify-center gap-1 rounded-[12px] border border-dashed border-ink/[0.15] py-2 text-[11px] text-[var(--beat-text-2)] transition hover:border-ink/30 hover:text-ink"
          >
            <Plus className="size-3" />
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
          className={cn('pointer-events-auto absolute', draggingId === 'final' && 'z-30')}
          style={{ ...posStyle('final') }}
        >
          <NodeShell
            title={m['drama.final.title']()}
            subtitle={m['drama.final.subtitle']({ shots: doc.shots.length, seconds: Math.round(grandTotal) })}
            icon={<Sparkles className="size-3.5" />}
            accent
          >
            <p className="mb-2 text-[10px] leading-4 text-[var(--beat-text-3)]">
              {m['drama.final.hint']()}
            </p>
            <button
              type="button"
              disabled={doc.shots.length === 0 || doc.finalStatus === 'running'}
              onClick={() => void generateFinal()}
              className="flex w-full items-center justify-center gap-1.5 rounded-[8px] bg-[var(--beat-accent)] py-1.5 text-[11px] font-medium text-white transition hover:opacity-90 disabled:opacity-45"
            >
              <Wand2 className="size-3" />
              {doc.finalStatus === 'running' ? m['drama.final.running']() : m['drama.final.run']()}
            </button>
            {doc.finalStatus === 'failed' ? (
              <p className="mt-1.5 text-[9px] text-red-400">{m['drama.final.failed']()}</p>
            ) : null}
            {doc.finalVideoUrl ? (
              <video src={doc.finalVideoUrl} controls className="mt-2 w-full rounded-[8px]" />
            ) : null}
          </NodeShell>
        </div>
      </div>

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

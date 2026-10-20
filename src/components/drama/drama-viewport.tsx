import {
  Maximize2,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { m } from '@/paraglide/messages.js';
import { HelpPopover } from '@/components/drama/help-popover';
import { cn } from '@/lib/utils';

/**
 * Pan/zoom viewport for the drama canvas.
 *
 * The freeform board gets this from React Flow; the drama pipeline lays its nodes
 * out in fixed columns, so it needs the same navigation without the graph engine.
 * Everything here follows the conventions people already know from FigJam,
 * tldraw and LibTV:
 *
 *   wheel            zoom at the cursor (not the centre)
 *   drag / space     pan
 *   ctrl/cmd + 0     reset to 100%
 *   shift + 1        fit the whole pipeline
 *   +/-              zoom steps
 *
 * The stage is a single transformed element, so connectors drawn in content
 * coordinates scale together with the cards.
 */

const MIN_SCALE = 0.15;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 1.2;

type View = { x: number; y: number; k: number };

export type ViewportMarker = {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: 'node' | 'shot';
};

export function DramaViewport({
  contentWidth,
  contentHeight,
  markers,
  onScaleChange,
  onResetLayout,
  onAutoArrange,
  onMarquee,
  apiRef,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  children,
}: {
  contentWidth: number;
  contentHeight: number;
  markers: ViewportMarker[];
  /** Reported so drag maths can convert screen pixels to content pixels. */
  onScaleChange?: (scale: number) => void;
  /** Clears any dragged positions and returns to the default pipeline layout. */
  onResetLayout?: () => void;
  /** Tidies the board: columns aligned, stacks spaced by measured height. */
  onAutoArrange?: () => void;
  /** Reports a marquee in content coordinates, or null when it was a click. */
  onMarquee?: (rect: { x: number; y: number; w: number; h: number } | null, additive: boolean) => void;
  /** Lets the board move the view, e.g. to reveal a node it just created. */
  apiRef?: React.MutableRefObject<{ centerOn: (x: number, y: number) => void } | null>;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  // Track the last pointer position and apply the delta each move. An absolute
  // origin-plus-offset form jumped when the pointer moved faster than React could
  // re-render, so the pan ran away from the cursor.
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const [panning, setPanning] = useState(false);
  // FigJam convention: drag empty space selects, space/middle drags pans.
  const [spaceDown, setSpaceDown] = useState(false);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeRef = useRef<{ pointerId: number; x1: number; y1: number } | null>(null);
  const spaceRef = useRef(false);

  const clampScale = (k: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));

  useEffect(() => {
    onScaleChange?.(view.k);
  }, [onScaleChange, view.k]);

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const padding = 48;
    const k = clampScale(
      Math.min(
        (rect.width - padding * 2) / contentWidth,
        (rect.height - padding * 2) / contentHeight,
        1
      )
    );
    setView({
      x: (rect.width - contentWidth * k) / 2,
      y: (rect.height - contentHeight * k) / 2,
      k,
    });
  }, [contentWidth, contentHeight]);

  // Fit once on mount so the first view is the pipeline, not the top-left corner.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current) return;
    if (!viewportRef.current) return;
    fittedRef.current = true;
    fit();
  }, [fit]);

  const zoomAt = useCallback((nextScale: number, cx: number, cy: number) => {
    setView((current) => {
      const k = clampScale(nextScale);
      if (k === current.k) return current;
      // Keep the point under the cursor pinned while scaling.
      const ratio = k / current.k;
      return {
        k,
        x: cx - (cx - current.x) * ratio,
        y: cy - (cy - current.y) * ratio,
      };
    });
  }, []);

  const zoomByCenter = useCallback(
    (factor: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setView((current) => {
        const k = clampScale(current.k * factor);
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const ratio = k / current.k;
        return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
      });
    },
    []
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      // ctrl/cmd + wheel is the pinch gesture browsers synthesise on trackpads.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const el = viewportRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * 0.0015);
        setView((current) => {
          const k = clampScale(current.k * factor);
          const ratio = k / current.k;
          const cx = event.clientX - rect.left;
          const cy = event.clientY - rect.top;
          return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
        });
        return;
      }
      // Plain wheel pans — that is what a trackpad two-finger scroll has to do.
      // Zoom is ctrl/cmd + wheel above; shift pans sideways.
      event.preventDefault();
      const dx = event.shiftKey ? event.deltaY : event.deltaX;
      const dy = event.shiftKey ? 0 : event.deltaY;
      setView((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
    },
    [zoomAt]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Only the background takes the gesture, so inputs inside the cards keep working.
      const target = event.target as HTMLElement;
      const isBackground = target.dataset.dramaBackground === 'true';
      if (!isBackground) return;
      // 0 = select, 1 = middle pan, 2 = right pan (the usual shortcut in node editors)
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;

      const wantsPan = event.button === 1 || event.button === 2 || spaceRef.current;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured.
      }

      if (wantsPan) {
        panRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
        };
        setPanning(true);
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();
      marqueeRef.current = {
        pointerId: event.pointerId,
        x1: event.clientX - bounds.left,
        y1: event.clientY - bounds.top,
      };
      setMarquee({
        x1: event.clientX - bounds.left,
        y1: event.clientY - bounds.top,
        x2: event.clientX - bounds.left,
        y2: event.clientY - bounds.top,
      });
    },
    []
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = marqueeRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const bounds = event.currentTarget.getBoundingClientRect();
      setMarquee((current) =>
        current
          ? { ...current, x2: event.clientX - bounds.left, y2: event.clientY - bounds.top }
          : current
      );
      return;
    }

    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.lastX;
    const dy = event.clientY - pan.lastY;
    if (dx === 0 && dy === 0) return;
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, []);

  const endPan = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = marqueeRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        marqueeRef.current = null;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x2 = event.clientX - bounds.left;
        const y2 = event.clientY - bounds.top;
        const x1 = drag.x1;
        const y1 = drag.y1;
        setMarquee(null);
        // A tiny drag is a click: clear the selection.
        if (Math.abs(x2 - x1) < 4 && Math.abs(y2 - y1) < 4) {
          onMarquee?.(null, event.shiftKey);
          return;
        }
        // Screen coordinates back to content coordinates.
        const k = view.k || 1;
        onMarquee?.(
          {
            x: (Math.min(x1, x2) - view.x) / k,
            y: (Math.min(y1, y2) - view.y) / k,
            w: Math.abs(x2 - x1) / k,
            h: Math.abs(y2 - y1) / k,
          },
          event.shiftKey
        );
        return;
      }

      if (panRef.current?.pointerId === event.pointerId) {
        panRef.current = null;
        setPanning(false);
      }
    },
    [onMarquee, view.k, view.x, view.y]
  );

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      spaceRef.current = true;
      setSpaceDown(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spaceRef.current = false;
      setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // The shortcuts every canvas app shares.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (typing) return;

      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault();
        setView((current) => ({ ...current, k: 1 }));
        return;
      }
      if (event.shiftKey && event.key === '1') {
        event.preventDefault();
        fit();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomByCenter(ZOOM_STEP);
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomByCenter(1 / ZOOM_STEP);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, zoomByCenter]);

  /** Put a content-space point in the middle of the viewport. */
  const centerOn = useCallback((contentX: number, contentY: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setView((current) => ({
      ...current,
      x: rect.width / 2 - contentX * current.k,
      y: rect.height / 2 - contentY * current.k,
    }));
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { centerOn };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, centerOn]);

  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapDraggingRef = useRef(false);
  const [viewportBox, setViewportBox] = useState({ x: 0, y: 0, w: 1, h: 1 });

  // The rectangle drawn on the minimap.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setViewportBox({
        x: -view.x / view.k,
        y: -view.y / view.k,
        w: rect.width / view.k,
        h: rect.height / view.k,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [view]);

  const minimap = useMemo(() => {
    const W = 168;
    const H = 112;
    const pad = 6;
    const k = Math.min((W - pad * 2) / contentWidth, (H - pad * 2) / contentHeight);
    return { W, H, k, pad };
  }, [contentWidth, contentHeight]);

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative h-full w-full overflow-hidden bg-[var(--beat-bg)]',
        panning ? 'cursor-grabbing' : spaceDown ? 'cursor-grab' : 'cursor-default'
      )}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
      onDoubleClick={(event) => {
        // Only a double-click on empty canvas fits; a double-click on a card is not
        // a navigation command.
        // Pointer capture retargets the second click to the container itself, so
        // accept that as empty space too.
        const target = event.target as HTMLElement;
        const isEmpty = target.dataset.dramaBackground === 'true' || target === event.currentTarget;
        if (isEmpty) fit();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      style={{ touchAction: 'none' }}
    >
      {/* Background layer: drag empty space to pan. */}
      <div
        data-drama-background="true"
        className="absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(var(--beatcanvas-grid-dot) 1px, transparent 1px)', backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      />

      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{
          width: contentWidth,
          height: contentHeight,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
        }}
      >
        {children}
      </div>

      {marquee ? (
        <div
          className="pointer-events-none absolute border border-[var(--beat-accent)] bg-[var(--beat-accent)]/12"
          style={{
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
          }}
        />
      ) : null}

      {/* Zoom bar, same semantics as the freeform canvas. */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-ink/[0.1] bg-[var(--beat-surface)]/95 px-1.5 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.18)] backdrop-blur">
        <button
          type="button"
          onClick={() => zoomByCenter(1 / ZOOM_STEP)}
          aria-label={m['drama.view.zoomOut']()}
          className="grid size-7 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setView((current) => ({ ...current, k: 1 }))}
          className="min-w-[46px] rounded-full px-1 py-0.5 text-[13px] tabular-nums text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink"
          title={m['drama.view.resetZoom']()}
        >
          {Math.round(view.k * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomByCenter(ZOOM_STEP)}
          aria-label={m['drama.view.zoomIn']()}
          className="grid size-7 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink"
        >
          <Plus className="size-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-ink/[0.12]" />
        <button
          type="button"
          onClick={fit}
          aria-label={m['drama.view.fit']()}
          title={m['drama.view.fitHint']()}
          className="grid size-7 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink"
        >
          <Maximize2 className="size-3.5" />
        </button>
        {onAutoArrange ? (
          <>
            <span className="mx-0.5 h-4 w-px bg-ink/[0.12]" />
            <button
              type="button"
              onClick={onAutoArrange}
              title={m['drama.view.autoArrange']()}
              className="rounded-full px-2 py-0.5 text-[14px] text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink"
            >
              {m['drama.view.autoArrange']()}
            </button>
          </>
        ) : null}
        {onResetLayout ? (
          <>
            <span className="mx-0.5 h-4 w-px bg-ink/[0.12]" />
            <button
              type="button"
              onClick={onResetLayout}
              title={m['drama.view.resetLayout']()}
              className="rounded-full px-2 py-0.5 text-[14px] text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink"
            >
              {m['drama.view.resetLayout']()}
            </button>
          </>
        ) : null}
        <span className="mx-0.5 h-4 w-px bg-ink/[0.12]" />
        <HelpPopover id="canvas" />
        <span className="mx-0.5 h-4 w-px bg-ink/[0.12]" />
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label={m['drama.view.undo']()}
          className="grid size-7 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <Undo2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label={m['drama.view.redo']()}
          className="grid size-7 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <Redo2 className="size-3.5" />
        </button>
      </div>

      {/* Minimap: with forty workbenches this is how you stay oriented. Click to jump. */}
      <div
        ref={minimapRef}
        role="presentation"
        onPointerDown={(event) => {
          minimapDraggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          centerOn(
            (event.clientX - rect.left - minimap.pad) / minimap.k,
            (event.clientY - rect.top - minimap.pad) / minimap.k
          );
        }}
        onPointerMove={(event) => {
          if (!minimapDraggingRef.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          centerOn(
            (event.clientX - rect.left - minimap.pad) / minimap.k,
            (event.clientY - rect.top - minimap.pad) / minimap.k
          );
        }}
        onPointerUp={() => {
          minimapDraggingRef.current = false;
        }}
        onPointerCancel={() => {
          minimapDraggingRef.current = false;
        }}
        className="absolute bottom-4 right-4 hidden cursor-pointer overflow-hidden rounded-[10px] border border-ink/[0.1] bg-[var(--beat-surface)]/92 shadow-[0_10px_26px_rgba(0,0,0,0.16)] backdrop-blur sm:block"
        style={{ width: minimap.W, height: minimap.H }}
      >
        <svg width={minimap.W} height={minimap.H} aria-hidden="true">
          {markers.map((marker, index) => (
            <rect
              key={index}
              x={minimap.pad + marker.x * minimap.k}
              y={minimap.pad + marker.y * minimap.k}
              width={Math.max(3, marker.w * minimap.k)}
              height={Math.max(2.5, marker.h * minimap.k)}
              rx={1.5}
              fill={marker.tone === 'shot' ? 'var(--beat-accent)' : 'var(--beat-text-3)'}
              opacity={marker.tone === 'shot' ? 0.55 : 0.4}
            />
          ))}
          <rect
            x={minimap.pad + viewportBox.x * minimap.k}
            y={minimap.pad + viewportBox.y * minimap.k}
            width={Math.max(6, viewportBox.w * minimap.k)}
            height={Math.max(6, viewportBox.h * minimap.k)}
            rx={2}
            fill="none"
            stroke="var(--beat-accent)"
            strokeWidth={1.2}
            opacity={0.9}
          />
        </svg>
      </div>
    </div>
  );
}

import { HelpCircle, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';

/**
 * Floating usage notes for a node or for the canvas itself.
 *
 * The popover is portalled to `body` and positioned with fixed coordinates rather
 * than living inside the node: the board is a scaled transform, so anything
 * rendered inside it would shrink with the zoom and be unreadable exactly when a
 * newcomer needs it most.
 */

export type HelpId = 'script' | 'board' | 'assets' | 'params' | 'shot' | 'final' | 'canvas';

const WIDTH = 268;
const MARGIN = 12;

// An explicit map: paraglide's table is typed per key, so a composed key is not
// indexable and the messages take no arguments here.
const HELP_TEXT: Record<HelpId, { title: () => string; body: () => string }> = {
  script: { title: m['help.script.title'], body: m['help.script.body'] },
  board: { title: m['help.board.title'], body: m['help.board.body'] },
  assets: { title: m['help.assets.title'], body: m['help.assets.body'] },
  params: { title: m['help.params.title'], body: m['help.params.body'] },
  shot: { title: m['help.shot.title'], body: m['help.shot.body'] },
  final: { title: m['help.final.title'], body: m['help.final.body'] },
  canvas: { title: m['help.canvas.title'], body: m['help.canvas.body'] },
};

export function HelpPopover({
  id,
  className,
  label,
}: {
  id: HelpId;
  className?: string;
  label?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean }>({
    left: 0,
    top: 0,
    above: false,
  });

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 170;

    let left = rect.left - 8;
    if (left + WIDTH + MARGIN > window.innerWidth) {
      left = window.innerWidth - WIDTH - MARGIN;
    }
    left = Math.max(MARGIN, left);

    const below = rect.bottom + 8;
    const above = rect.top - panelHeight - 8;
    const fitsBelow = below + panelHeight + MARGIN <= window.innerHeight;
    setPos({ left, top: fitsBelow ? below : Math.max(MARGIN, above), above: !fitsBelow });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onReflow = () => place();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, place]);

  const title = HELP_TEXT[id].title();
  const body = HELP_TEXT[id].body();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={m['help.open']()}
        aria-expanded={open}
        title={m['help.open']()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-full text-[var(--beat-text-3)] transition hover:bg-ink/[0.08] hover:text-[var(--beat-text-1)]',
          className
        )}
      >
        <HelpCircle className="size-3" />
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={label ?? title}
              style={{ position: 'fixed', left: pos.left, top: pos.top, width: WIDTH }}
              className="z-[80] overflow-hidden rounded-[12px] border border-ink/[0.12] bg-[var(--beat-surface)] shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-ink/[0.08] px-3 py-2">
                <span className="text-[12px] font-medium text-[var(--beat-text-1)]">{title}</span>
                <button
                  type="button"
                  aria-label={m['help.close']()}
                  onClick={() => setOpen(false)}
                  className="grid size-4 place-items-center rounded-full text-[var(--beat-text-3)] transition hover:bg-ink/[0.08] hover:text-[var(--beat-text-1)]"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div className="max-h-[46vh] overflow-y-auto px-3 py-2.5">
                <p className="whitespace-pre-line text-[11px] leading-[1.7] text-[var(--beat-text-2)]">
                  {body}
                </p>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

/**
 * Hover hint. Shows a small explanation box above the target on hover or focus.
 *
 * Why a portal: composer and canvas cards clip their overflow, so an absolutely
 * positioned box gets cut off near the card edge — the same problem the model
 * dropdown hit, which is why it portals too. The box mounts on body and is placed
 *
 * via the anchor's getBoundingClientRect.
 * Accessibility: aria-describedby points at the box while it is open, so keyboard
 */
export function HintTip({
  label,
  description,
  children,
  side = 'top',
  className,
  disabled = false,
}: {
  /** One-line title, e.g. "Model". */
  label: string;
  /** Optional longer explanation. */
  description?: string;
  children: ReactNode;
  /** Where the box sits relative to the target. Use bottom near the top edge. */
  side?: 'top' | 'bottom';
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const tipId = useId();

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const GAP = 10;
    setCoords({
      left: rect.left + rect.width / 2,
      top: side === 'top' ? rect.top - GAP : rect.bottom + GAP,
    });
  }, [side]);

  const show = useCallback(() => {
    if (disabled) return;
    place();
    setOpen(true);
  }, [disabled, place]);

  const hide = useCallback(() => setOpen(false), []);

  // Close on scroll/resize: repositioning is fiddly and a stale box looks worse than none.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  if (disabled) return <span className={className}>{children}</span>;

  return (
    <span
      ref={anchorRef}
      className={cn('inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      aria-describedby={open ? tipId : undefined}
    >
      {children}
      {open && coords
        ? createPortal(
            <span
              id={tipId}
              role="tooltip"
              style={{
                position: 'fixed',
                left: coords.left,
                top: coords.top,
                transform:
                  side === 'top'
                    ? 'translate(-50%, -100%)'
                    : 'translate(-50%, 0)',
              }}
              className="pointer-events-none z-[9999] w-max max-w-[280px] rounded-[10px] border border-ink/12 bg-[var(--beat-surface-2)] px-3 py-2 text-left shadow-[0_18px_48px_rgba(0,0,0,0.6)]"
            >
              <span className="block text-[13.5px] font-medium leading-6 text-[var(--beat-text-1)]">
                {label}
              </span>
              {description ? (
                <span className="mt-0.5 block text-[13px] leading-[18px] text-[var(--beat-text-2)]">
                  {description}
                </span>
              ) : null}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

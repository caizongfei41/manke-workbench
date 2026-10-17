import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

/**
 * Image hover preview.
 *
 * Thumbnails are tiny, so hovering shows the full image beside them. The preview is
 * portalled to body because panels and cards clip their overflow.
 *
 * Placement prefers the right side, flips left when it does not fit, and clamps vertically.
 */
export function ImageHoverPreview({
  src,
  alt,
  children,
  className,
  previewWidth = 320,
  previewHeight = 320,
  disabled = false,
}: {
  src?: string | null;
  alt?: string;
  children: ReactNode;
  className?: string;
  previewWidth?: number;
  previewHeight?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const GAP = 12;
    const MARGIN = 12;

    let left = rect.right + GAP;
    if (left + previewWidth > window.innerWidth - MARGIN) {
      left = rect.left - previewWidth - GAP;
    }
    if (left < MARGIN) left = MARGIN;

    let top = rect.top + rect.height / 2 - previewHeight / 2;
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - previewHeight - MARGIN));

    setPos({ top, left });
  }, [previewWidth, previewHeight]);

  const show = useCallback(() => {
    if (disabled || !src) return;
    place();
    setOpen(true);
  }, [disabled, place, src]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <span
      ref={anchorRef}
      className={cn('inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={show}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      {open && pos && src
        ? createPortal(
            <span
              role="tooltip"
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                width: previewWidth,
                height: previewHeight,
              }}
              className="pointer-events-none z-[9998] block overflow-hidden rounded-[12px] border border-ink/15 bg-[var(--beat-surface)] shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
            >
              <img src={src} alt={alt ?? ''} className="h-full w-full object-contain" />
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

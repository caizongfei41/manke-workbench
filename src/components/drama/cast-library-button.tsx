import { Library, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';

/**
 * Pick a portrait from the shared cast library, or save the current one into it.
 *
 * Portalled to `body`: the board is a scaled transform, and a picker rendered
 * inside it would shrink with the zoom.
 */

export type CastLibraryItem = { assetId: string; name: string; url: string };

export function CastLibraryButton({
  projectId,
  sourceAssetId,
  assetName,
  hasImage,
  onPicked,
}: {
  projectId: string;
  /** The project asset this row shows; needed to save its bytes into the library. */
  sourceAssetId: string;
  assetName: string;
  hasImage: boolean;
  onPicked: (url: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CastLibraryItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const load = useCallback(async () => {
    const res = await fetch('/api/app/cast-library').catch(() => null);
    const json = await res?.json().catch(() => null);
    setItems(Array.isArray(json?.items) ? json.items : []);
  }, []);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - 300)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 260),
    });
    setNotice(null);
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const useItem = async (item: CastLibraryItem) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/app/projects/${projectId}/cast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1' },
        body: JSON.stringify({ libraryAssetId: item.assetId, name: assetName }),
      });
      const json = await res.json().catch(() => null);
      if (json?.url) {
        onPicked(json.url);
        setOpen(false);
      } else {
        setNotice(m['cast.error']());
      }
    } catch {
      setNotice(m['cast.error']());
    } finally {
      setBusy(false);
    }
  };

  const saveCurrent = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/app/cast-library', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1' },
        body: JSON.stringify({
          sourceProjectId: projectId,
          assetId: sourceAssetId,
          name: assetName,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.assetId) {
        await load();
        setNotice(m['cast.saved']());
      } else {
        setNotice(m['cast.error']());
      }
    } catch {
      setNotice(m['cast.error']());
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={m['cast.open']()}
        aria-expanded={open}
        title={m['cast.open']()}
        className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[9px] text-[var(--beat-text-2)] transition hover:bg-ink/[0.06] hover:text-ink"
      >
        <Library className="size-2.5" />
        {m['cast.button']()}
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={m['cast.open']()}
              style={{ position: 'fixed', left: pos.left, top: pos.top, width: 292 }}
              className="z-[80] overflow-hidden rounded-[12px] border border-ink/[0.12] bg-[var(--beat-surface)] shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
            >
              <div className="flex items-center justify-between border-b border-ink/[0.08] px-3 py-2">
                <span className="text-[12px] font-medium text-[var(--beat-text-1)]">
                  {m['cast.title']()}
                </span>
                <span className="text-[10px] text-[var(--beat-text-3)]">
                  {items === null ? m['cast.loading']() : m['cast.count']({ count: items.length })}
                </span>
              </div>

              <div className="max-h-[200px] overflow-y-auto p-2">
                {items !== null && items.length === 0 ? (
                  <p className="px-1 py-3 text-center text-[10.5px] text-[var(--beat-text-3)]">
                    {m['cast.empty']()}
                  </p>
                ) : null}
                <div className="grid grid-cols-3 gap-1.5">
                  {(items ?? []).map((item) => (
                    <button
                      key={item.assetId}
                      type="button"
                      disabled={busy}
                      onClick={() => void useItem(item)}
                      title={item.name}
                      className="group overflow-hidden rounded-[8px] border border-ink/[0.1] transition hover:border-[var(--beat-accent)]/50 disabled:opacity-50"
                    >
                      <img src={item.url} alt={item.name} className="aspect-square w-full object-cover" />
                      <span className="block truncate px-1 py-0.5 text-[9px] text-[var(--beat-text-2)]">
                        {item.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-ink/[0.08] p-2">
                <button
                  type="button"
                  disabled={!hasImage || busy}
                  onClick={() => void saveCurrent()}
                  className={cn(
                    'flex w-full items-center justify-center gap-1.5 rounded-[7px] py-1.5 text-[10.5px] transition',
                    hasImage
                      ? 'bg-[var(--beat-accent)]/10 text-[var(--beat-accent)] hover:bg-[var(--beat-accent)]/18'
                      : 'cursor-not-allowed text-[var(--beat-text-3)]'
                  )}
                >
                  <Save className="size-3" />
                  {hasImage ? m['cast.saveCurrent']() : m['cast.saveDisabled']()}
                </button>
                {notice ? (
                  <p className="mt-1 text-center text-[9.5px] text-[var(--beat-text-3)]">{notice}</p>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

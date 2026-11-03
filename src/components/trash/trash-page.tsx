'use client';

import { useRouter } from '@tanstack/react-router';
import { ChevronLeft, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';

/**
 * Trash page.
 *
 * Deleted projects stay here for 7 days. The list comes from
 * GET /api/app/trash, which also sweeps expired entries on every read --
 * a local single-user app has no daemon, so hanging cleanup off the read path
 * is the simplest reliable trigger.
 */

type TrashEntry = {
  id: string;
  kind: string;
  name: string;
  bytes: number;
  files: number;
  deletedAt: string;
  expiresInDays: number;
  expired: boolean;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

export function TrashPage({ locale }: { locale: string }) {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TrashEntry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [retentionDays, setRetentionDays] = useState(7);
  const [totalBytes, setTotalBytes] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/app/trash', {
        headers: { 'x-beatapi-workspace-request': '1' },
      });
      const data = (await res.json()) as {
        entries?: TrashEntry[];
        totalBytes?: number;
        retentionDays?: number;
        swept?: number;
      };
      setEntries(data.entries ?? []);
      setTotalBytes(data.totalBytes ?? 0);
      setRetentionDays(data.retentionDays ?? 7);
      if (data.swept && data.swept > 0) {
        setMessage(m['trash.autoSwept']({ count: String(data.swept) }));
      }
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (entry: TrashEntry) => {
    setBusyId(entry.id);
    setMessage(null);
    try {
      const res = await fetch('/api/app/trash', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-beatapi-workspace-request': '1',
        },
        body: JSON.stringify({ id: entry.id }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (data.ok) {
        setMessage(m['trash.restored']());
        await load();
        // The project list lives in a route loader cache attached to
        // /zh/projects. router.invalidate() with no target clears only the
        // current route (/zh/trash), so the Projects tab kept its pre-restore
        // snapshot and a restore looked like it had done nothing.
        await router.invalidate({ sync: true });
      } else {
        setMessage(m['trash.restoreFailed']({ message: data.message ?? '' }));
      }
    } catch (error) {
      setMessage(
        m['trash.restoreFailed']({
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setBusyId(null);
    }
  };

  const deleteForever = async (entry: TrashEntry) => {
    setBusyId(entry.id);
    setConfirmDelete(null);
    try {
      await fetch('/api/app/trash', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-beatapi-workspace-request': '1',
        },
        body: JSON.stringify({ id: entry.id }),
      });
      setMessage(m['trash.deleted']());
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = async () => {
    setConfirmClear(false);
    try {
      await fetch('/api/app/trash', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-beatapi-workspace-request': '1',
        },
        body: JSON.stringify({ all: true }),
      });
      setMessage(m['trash.cleared']());
      await load();
    } catch {
      /* leave the list as-is; the user can retry */
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 pb-16 pt-6 sm:px-8">
      <div className="flex items-center gap-3">
        <Link
          href="/projects"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink/10 px-3 text-[12.5px] text-[var(--beat-text-2)] transition hover:border-ink/20"
        >
          <ChevronLeft className="size-3.5" />
          {m['trash.title']()}
        </Link>
      </div>

      <header className="mt-6">
        <h1 className="text-[26px] font-semibold tracking-tight text-[var(--beat-text-1)]">
          {m['trash.title']()}
        </h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-[var(--beat-text-3)]">
          {m['trash.subtitle']({ days: String(retentionDays) })}
        </p>
        {entries.length > 0 ? (
          <p className="mt-2 text-[12.5px] text-[var(--beat-text-3)]">
            {m['trash.itemCount']({ count: String(entries.length) })} ·{' '}
            {m['trash.totalSize']({ size: formatSize(totalBytes) })}
          </p>
        ) : null}
      </header>

      {message ? (
        <div className="mt-4 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-10 text-[13px] text-[var(--beat-text-3)]">{m['trash.loading']()}</p>
      ) : entries.length === 0 ? (
        <div className="mt-10 rounded-[var(--beat-radius)] border border-dashed border-ink/12 px-6 py-16 text-center">
          <Trash2 className="mx-auto size-8 text-ink/20" />
          <p className="mt-3 text-[14px] font-medium text-[var(--beat-text-2)]">
            {m['trash.empty']()}
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--beat-text-3)]">
            {m['trash.emptyHint']()}
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-3 rounded-[var(--beat-radius)] border border-ink/[0.07] bg-white px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-[var(--beat-text-1)]">
                    {entry.name}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-[var(--beat-text-3)]">
                    {formatDate(entry.deletedAt)} · {formatSize(entry.bytes)} ·{' '}
                    {entry.expiresInDays > 0
                      ? m['trash.expiresIn']({ days: String(entry.expiresInDays) })
                      : m['trash.expiresToday']()}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => void restore(entry)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--beat-accent)] px-3 text-[12px] font-medium text-white transition disabled:opacity-40"
                >
                  <RotateCcw className="size-3.5" />
                  {m['trash.restore']()}
                </button>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => setConfirmDelete(entry)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink/10 px-3 text-[12px] text-[var(--beat-text-2)] transition hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                  {m['trash.deleteForever']()}
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-full border border-ink/10 px-4 text-[12.5px] text-[var(--beat-text-2)] transition hover:border-red-300 hover:text-red-600"
          >
            <Trash2 className="size-3.5" />
            {m['trash.clearAll']()}
          </button>
        </>
      )}

      <ConfirmDialog
        variant="beat"
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={m['trash.confirmDeleteTitle']()}
        description={m['trash.confirmDeleteBody']()}
        confirmLabel={m['trash.deleteForever']()}
        cancelLabel={m['trash.cancel']()}
        onConfirm={() => {
          if (confirmDelete) void deleteForever(confirmDelete);
        }}
      />

      <ConfirmDialog
        variant="beat"
        open={confirmClear}
        onOpenChange={(open) => {
          if (!open) setConfirmClear(false);
        }}
        title={m['trash.confirmClearTitle']()}
        description={m['trash.confirmClearBody']({ count: String(entries.length) })}
        confirmLabel={m['trash.clearAll']()}
        cancelLabel={m['trash.cancel']()}
        onConfirm={() => void clearAll()}
      />
    </div>
  );
}

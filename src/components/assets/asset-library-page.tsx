import { useEffect, useMemo, useState } from 'react';
import { Check, Download, ExternalLink, Film, ImageIcon, Music4, Search, Trash2 } from 'lucide-react';

import { BeatApiProductShell } from '@/components/marketing/beatapi-product-shell';
import { buildLocalizedProjectDetailPath } from '@/core/projects/project-entry';
import { m } from '@/paraglide/messages';

/**
 * The library across every project.
 *
 * The per-project tab answers "what did this film use"; this answers "where is that
 * image from", which is the question people actually ask a week later.
 */

type LibraryAsset = {
  id: string;
  publicUrl: string | null;
  filename?: string | null;
  width: number | null;
  height: number | null;
  durationMs?: number | null;
  createdAt: string | Date;
  projectId?: string | null;
  projectName?: string | null;
};

type Kind = 'all' | 'image' | 'video' | 'audio';

// Paraglide keys are statically typed, so the label has to be picked, not indexed.
const kindLabel = (value: Exclude<Kind, 'all'>) => {
  if (value === 'video') return m['assets.library.kindVideo']();
  if (value === 'audio') return m['assets.library.kindAudio']();
  return m['assets.library.kindImage']();
};

const kindOf = (asset: LibraryAsset, bucket: Exclude<Kind, 'all'>): Exclude<Kind, 'all'> => bucket;

const formatDate = (value: string | Date) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
};

const formatDuration = (ms?: number | null) => {
  if (!ms || ms <= 0) return '';
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function AssetLibraryPage({ locale }: { locale: string }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [open, setOpen] = useState<LibraryAsset | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/app/recent-assets?limit=120', {
          headers: { 'x-beatapi-workspace-request': '1' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as {
          images?: LibraryAsset[];
          videos?: LibraryAsset[];
          audios?: LibraryAsset[];
        };
        if (cancelled) return;
        const tagged: LibraryAsset[] = [
          ...(payload.images ?? []).map((asset) => ({ ...asset, assetKind: 'image' as const })),
          ...(payload.videos ?? []).map((asset) => ({ ...asset, assetKind: 'video' as const })),
          ...(payload.audios ?? []).map((asset) => ({ ...asset, assetKind: 'audio' as const })),
        ].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ) as LibraryAsset[];
        setAssets(tagged);
        setLoading(false);
      } catch (cause) {
        if (cancelled) return;
        setError(String(cause));
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of assets) {
      if (asset.projectId) seen.set(asset.projectId, asset.projectName ?? asset.projectId);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [assets, locale]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const bucket = (asset as { assetKind?: string }).assetKind ?? 'image';
      if (kind !== 'all' && bucket !== kind) return false;
      if (projectFilter !== 'all' && asset.projectId !== projectFilter) return false;
      if (!needle) return true;
      return (
        (asset.filename ?? '').toLowerCase().includes(needle) ||
        (asset.projectName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [assets, query, kind, projectFilter]);

  const counts = useMemo(
    () => ({
      all: assets.length,
      image: assets.filter((a) => (a as { assetKind?: string }).assetKind === 'image').length,
      video: assets.filter((a) => (a as { assetKind?: string }).assetKind === 'video').length,
      audio: assets.filter((a) => (a as { assetKind?: string }).assetKind === 'audio').length,
    }),
    [assets]
  );

  const toggleSelected = (id: string, additive: boolean) => {
    setSelected((current) => {
      const next = new Set(additive ? current : new Set<string>());
      if (additive && current.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () =>
    setSelected(new Set(visible.map((asset) => asset.id)));

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const response = await fetch('/api/app/assets', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-beatapi-workspace-request': '1',
        },
        body: JSON.stringify({ assetIds: ids }),
      });
      if (!response.ok) throw new Error(String(response.status));
      // Drop them locally so the grid does not wait on a full reload
      setAssets((current) => current.filter((asset) => !selected.has(asset.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  const tile = (asset: LibraryAsset) => {
    const bucket = (asset as { assetKind?: string }).assetKind ?? 'image';
    return (
      <div
        key={asset.id}
        data-library-asset={asset.id}
        className={`group relative min-w-0 overflow-hidden rounded-[14px] border bg-[var(--beat-surface)] text-left transition hover:-translate-y-0.5 hover:border-ink/20 ${
          selected.has(asset.id)
            ? 'border-[var(--beat-accent)] ring-1 ring-[var(--beat-accent)]/40'
            : 'border-ink/[0.08]'
        }`}
      >
        <button
          type="button"
          onClick={(event) => toggleSelected(asset.id, event.shiftKey || event.metaKey || event.ctrlKey)}
          aria-label={m['assets.library.select']()}
          aria-pressed={selected.has(asset.id)}
          data-library-select={asset.id}
          className={`absolute left-2 top-2 z-10 grid size-5 place-items-center rounded-[6px] border transition ${
            selected.has(asset.id)
              ? 'border-[var(--beat-accent)] bg-[var(--beat-accent)] text-[var(--beat-accent-ink)]'
              : 'border-white/70 bg-black/35 text-transparent opacity-0 group-hover:opacity-100'
          }`}
        >
          <Check className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(asset)}
          data-library-open={asset.id}
          className="block w-full text-left"
        >
        <div className="relative aspect-[4/3] overflow-hidden bg-ink/[0.04]">
          {bucket === 'image' && asset.publicUrl ? (
            <img
              src={asset.publicUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid size-full place-items-center text-[var(--beat-text-3)]">
              {bucket === 'video' ? <Film className="size-7" /> : <Music4 className="size-7" />}
            </div>
          )}
          {asset.durationMs ? (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1 py-0.5 text-[10px] tabular-nums text-white">
              {formatDuration(asset.durationMs)}
            </span>
          ) : null}
        </div>
        <div className="px-2.5 py-2">
          <p className="truncate text-[11.5px] text-[var(--beat-text-1)]" title={asset.filename ?? ''}>
            {asset.projectName ?? m['assets.library.noProject']()}
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--beat-text-3)]">
            {formatDate(asset.createdAt)}
          </p>
        </div>
        </button>
      </div>
    );
  };

  return (
    <BeatApiProductShell active="assets" locale={locale}>
      <main className="mx-auto w-full max-w-[1280px] px-5 pb-10 pt-14 sm:px-6">
        <section>
          <p className="text-[10px] font-semibold tracking-[0.18em] text-[var(--beat-accent)] sm:text-[11px]">
            {m['assets.library.eyebrow']()}
          </p>
          <h1 className="beat-product-display mt-4 max-w-3xl text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.04em] text-[var(--beat-text-1)]">
            {m['assets.library.title']()}
          </h1>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-6 text-[var(--beat-text-2)]">
            {m['assets.library.subtitle']()}
          </p>
        </section>

        <section className="mt-8 flex flex-wrap items-center gap-2" data-library-toolbar="true">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--beat-text-3)]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={m['assets.library.search']()}
              aria-label={m['assets.library.search']()}
              data-library-search="true"
              className="h-9 w-full rounded-[10px] border border-ink/[0.1] bg-[var(--beat-surface)] pl-8 pr-3 text-[12.5px] text-[var(--beat-text-1)] outline-none placeholder:text-[var(--beat-text-3)]"
            />
          </div>
          <div className="flex items-center gap-1 rounded-[10px] border border-ink/[0.1] bg-[var(--beat-surface)] p-1">
            {(['all', 'image', 'video', 'audio'] as Kind[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                data-library-kind={value}
                aria-pressed={kind === value}
                className={`h-7 rounded-[7px] px-2.5 text-[11.5px] transition ${
                  kind === value
                    ? 'bg-[var(--beat-accent)] text-[var(--beat-accent-ink)]'
                    : 'text-[var(--beat-text-2)] hover:text-ink'
                }`}
              >
                {value === 'all' ? m['assets.library.kindAll']() : kindLabel(value)}
                <span className="ml-1 tabular-nums opacity-60">{counts[value]}</span>
              </button>
            ))}
          </div>
          {selected.size > 0 ? (
            <div className="flex items-center gap-1.5" data-library-selection="true">
              <span className="text-[11.5px] tabular-nums text-[var(--beat-text-2)]">
                {m['assets.library.selected']({ count: String(selected.size) })}
              </span>
              <button
                type="button"
                onClick={selectAllVisible}
                className="h-8 rounded-[8px] border border-ink/[0.12] px-2 text-[11.5px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink"
              >
                {m['assets.library.selectAll']()}
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="h-8 rounded-[8px] px-2 text-[11.5px] text-[var(--beat-text-3)] transition hover:text-ink"
              >
                {m['assets.library.clear']()}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                data-library-delete="true"
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--beat-warn-text)] px-2.5 text-[11.5px] text-white"
              >
                <Trash2 className="size-3.5" />
                {m['assets.library.delete']()}
              </button>
            </div>
          ) : null}
          {projectOptions.length > 1 ? (
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              aria-label={m['assets.library.filterProject']()}
              data-library-project="true"
              className="h-9 max-w-[200px] rounded-[10px] border border-ink/[0.1] bg-[var(--beat-surface)] px-2 text-[12px] text-[var(--beat-text-2)] outline-none"
            >
              <option value="all">{m['assets.library.allProjects']()}</option>
              {projectOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
        </section>

        <section className="mt-6">
          {loading ? (
            <p className="py-16 text-center text-[13px] text-[var(--beat-text-3)]" data-library-loading="true">
              {m['assets.library.loading']()}
            </p>
          ) : error ? (
            <p className="py-16 text-center text-[13px] text-[var(--beat-warn-text)]" data-library-error="true">
              {m['assets.library.error']()}
            </p>
          ) : visible.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[var(--beat-radius)] border border-dashed border-ink/[0.1]">
              <ImageIcon className="size-6 text-[var(--beat-text-3)]" />
              <p className="mt-3 text-[13px] text-[var(--beat-text-2)]" data-library-empty="true">
                {assets.length === 0 ? m['assets.library.empty']() : m['assets.library.noMatch']()}
              </p>
              {assets.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setKind('all');
                    setProjectFilter('all');
                  }}
                  className="mt-3 text-[12px] text-[var(--beat-accent)] underline-offset-4 hover:underline"
                >
                  {m['assets.library.clear']()}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map(tile)}
            </div>
          )}
        </section>
      </main>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => (deleting ? null : setConfirming(false))}
        >
          <div
            className="w-full max-w-[420px] rounded-[16px] border border-ink/[0.1] bg-[var(--beat-surface)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-[15px] font-semibold text-[var(--beat-text-1)]">
              {m['assets.library.deleteConfirmTitle']({ count: String(selected.size) })}
            </h2>
            <p className="mt-2 text-[12.5px] leading-5 text-[var(--beat-text-2)]">
              {m['assets.library.deleteConfirmBody']()}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirming(false)}
                className="h-8 rounded-[8px] border border-ink/[0.12] px-3 text-[12px] text-[var(--beat-text-2)] disabled:opacity-50"
              >
                {m['assets.library.cancel']()}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void deleteSelected()}
                data-library-delete-confirm="true"
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--beat-warn-text)] px-3 text-[12px] text-white disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                {deleting ? m['assets.library.deleting']() : m['assets.library.delete']()}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6"
          role="dialog"
          aria-modal="true"
          data-library-preview="true"
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full max-w-[720px] overflow-hidden rounded-[16px] border border-ink/[0.1] bg-[var(--beat-surface)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bg-black/85">
              {(open as { assetKind?: string }).assetKind === 'video' ? (
                <video src={open.publicUrl ?? ''} controls className="max-h-[60vh] w-full" />
              ) : (open as { assetKind?: string }).assetKind === 'audio' ? (
                <div className="grid h-40 place-items-center">
                  <audio src={open.publicUrl ?? ''} controls />
                </div>
              ) : (
                <img src={open.publicUrl ?? ''} alt="" className="max-h-[60vh] w-full object-contain" />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[12.5px] text-[var(--beat-text-1)]">
                  {open.filename ?? open.projectName ?? '—'}
                </p>
                <p className="mt-0.5 text-[10.5px] text-[var(--beat-text-3)]">
                  {open.width && open.height ? `${open.width}×${open.height} · ` : ''}
                  {formatDate(open.createdAt)}
                  {open.projectName ? ` · ${open.projectName}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {open.projectId ? (
                  <a
                    href={buildLocalizedProjectDetailPath({
                      locale,
                      projectId: open.projectId,
                      mode: 'canvas',
                    })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-ink/[0.12] px-2.5 text-[11.5px] text-[var(--beat-text-2)] transition hover:border-ink/25 hover:text-ink"
                    data-library-open-project="true"
                  >
                    <ExternalLink className="size-3.5" />
                    {m['assets.library.openProject']()}
                  </a>
                ) : null}
                {open.publicUrl ? (
                  <a
                    href={open.publicUrl}
                    download
                    className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--beat-accent)] px-2.5 text-[11.5px] text-[var(--beat-accent-ink)]"
                  >
                    <Download className="size-3.5" />
                    {m['assets.library.download']()}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </BeatApiProductShell>
  );
}

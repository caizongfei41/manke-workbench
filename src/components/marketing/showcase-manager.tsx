import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ImagePlus, Loader2, Trash2, Video } from 'lucide-react';

import { normalizeLocale } from '@/config/locale';
import { m } from '@/paraglide/messages.js';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';

/**
 * Manage the front-page showcase.
 *
 * Uploads land in the curated project, which is exactly what the carousel reads, so
 * there is no separate publish step: add it here and it appears on the home page.
 *
 * Hiding is preferred over deleting for built-in entries — a deleted row comes back on
 * the next seed run, a hidden one stays hidden.
 */

type ShowcaseItem = {
  id: string;
  filename: string | null;
  type: string;
  publicUrl: string | null;
  source: string | null;
  metadata: unknown;
  createdAt: number | null;
};

const readHidden = (metadata: unknown) => {
  if (!metadata || typeof metadata !== 'object') return false;
  const showcase = (metadata as Record<string, unknown>).showcase;
  if (!showcase || typeof showcase !== 'object') return false;
  return (showcase as Record<string, unknown>).hidden === true;
};

const isBuiltin = (item: ShowcaseItem) => item.source === 'builtin';

export function ShowcaseManager({ locale }: { locale?: string }) {
  const messageLocale = normalizeLocale(locale ?? 'zh');
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/showcase');
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { projectId: string | null; items: ShowcaseItem[] };
      setItems(payload.items ?? []);
      setProjectId(payload.projectId);
    } catch (e) {
      setError(String(e).slice(0, 160));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Add to the front page: join the project, then clear the hidden flag. */
  const add = async (assetId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/app/showcase', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE,
        },
        body: JSON.stringify({ assetId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch (e) {
      setError(String(e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async (item: ShowcaseItem) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/app/showcase', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE,
        },
        body: JSON.stringify({ assetId: item.id, hidden: !readHidden(item.metadata) }),
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch (e) {
      setError(String(e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: ShowcaseItem) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/app/showcase?assetId=${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE },
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch (e) {
      setError(String(e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  /** Upload: the file lands straight in the curated project, so it is on the cover at once. */
  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const targetProject = projectId;
    if (!targetProject) {
      setError('The curated project does not exist yet — reload once.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const isVideo = file.type.startsWith('video/');
      const uploaded = await uploadLocalProjectAsset({
        projectId: targetProject,
        file,
        assetClass: 'original',
        metadata: { showcase: { hidden: false } },
      });
      // The upload endpoint already added it; just refresh.
      await load();
      void uploaded;
      void isVideo;
    } catch (e) {
      setError(String(e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  const images = items.filter((i) => i.type === 'image');
  const videos = items.filter((i) => i.type === 'video');

  return (
    <section className="flex flex-col gap-4" data-showcase-manager="true">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-semibold text-[var(--beat-text)]">
            {m['showcase.manager.title']({}, { locale: messageLocale })}
          </h2>
          <p className="mt-1 text-[13.5px] text-[var(--beat-text-2)]">
            {m['showcase.manager.subtitle']({}, { locale: messageLocale })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--beat-line)] bg-white px-3 text-[13.5px] font-medium text-[var(--beat-text)] transition hover:bg-[var(--beat-surface-2)] disabled:opacity-50"
          data-showcase-upload="true"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {m['showcase.manager.upload']({}, { locale: messageLocale })}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={onPick}
          data-showcase-file-input="true"
        />
      </header>

      {error ? (
        <p className="rounded-lg bg-[var(--beat-danger-soft,#FEF2F2)] px-3 py-2 text-[13px] text-[var(--beat-danger,#DC2626)]">
          {error}
        </p>
      ) : null}

      {[
        { key: 'image', label: m['showcase.manager.images']({}, { locale: messageLocale }), list: images },
        { key: 'video', label: m['showcase.manager.videos']({}, { locale: messageLocale }), list: videos },
      ].map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-[var(--beat-text-3)]">
            {group.label} · {group.list.length}
          </h3>
          {group.list.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--beat-line)] px-3 py-4 text-center text-[13px] text-[var(--beat-text-3)]">
              {m['showcase.manager.empty']({}, { locale: messageLocale })}
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4" data-showcase-grid={group.key}>
              {group.list.map((item) => {
                const hidden = readHidden(item.metadata);
                return (
                  <li
                    key={item.id}
                    className={`group relative overflow-hidden rounded-xl border border-[var(--beat-line)] bg-[var(--beat-surface-2)] ${
                      hidden ? 'opacity-45' : ''
                    }`}
                    data-showcase-item={item.id}
                    data-hidden={hidden ? 'true' : 'false'}
                  >
                    {item.publicUrl ? (
                      item.type === 'video' ? (
                        <video
                          src={item.publicUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="aspect-video w-full object-cover"
                        />
                      ) : (
                        <img
                          src={item.publicUrl}
                          alt=""
                          loading="lazy"
                          className="aspect-video w-full object-cover"
                        />
                      )
                    ) : (
                      <div className="flex aspect-video items-center justify-center">
                        {item.type === 'video' ? (
                          <Video className="size-5 text-[var(--beat-text-3)]" />
                        ) : (
                          <ImagePlus className="size-5 text-[var(--beat-text-3)]" />
                        )}
                      </div>
                    )}

                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-1.5 py-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => void toggleHidden(item)}
                        disabled={busy}
                        title={
                          hidden
                            ? m['showcase.manager.show']({}, { locale: messageLocale })
                            : m['showcase.manager.hide']({}, { locale: messageLocale })
                        }
                        className="rounded p-1 text-white/85 hover:text-white"
                      >
                        {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(item)}
                        disabled={busy}
                        title={m['showcase.manager.remove']({}, { locale: messageLocale })}
                        className="rounded p-1 text-white/85 hover:text-white"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>

                    {isBuiltin(item) ? (
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white/90">
                        {m['showcase.manager.builtin']({}, { locale: messageLocale })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}


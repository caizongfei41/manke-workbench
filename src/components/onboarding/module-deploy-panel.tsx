// Modular deploy panel: extract one archive at a time and offer to delete it.
//
// Replaces the single-button deploy. Three things matter here:
//   · Progress reads "3/9 parts", not a vague percentage
//   · Each finished part names the archive that can now be deleted
//   · Model parts can be skipped -- core + program (~8 GB) is enough to boot

import { useCallback, useEffect, useState } from 'react';

import { useTranslations } from '@/core/workspace-lib/shims/next-intl';


/** Modular deploy: the manifest describes each archive. */
export type BundleManifestPart = {
  id: string;
  name: string;
  label: string;
  order: number;
  file: string;
  bytes: number;
  sha256: string;
  fileCount: number;
};

export type BundleManifest = {
  version: number;
  archiveBase: string;
  createdAt: string;
  totalBytes: number;
  parts: BundleManifestPart[];
};

export type ModuleInspect = {
  total: number;
  doneCount: number;
  done: string[];
  pending: BundleManifestPart[];
  next: BundleManifestPart | null;
  complete: boolean;
};

/** The modules surface that onboarding-gate's DesktopApi merges in. */
export type ModulesApi = {
  manifest: () => Promise<BundleManifest | null>;
  inspect: (payload: { targetDir: string; manifest?: BundleManifest }) => Promise<ModuleInspect>;
  locate: (partId: string) => Promise<{
    ok: boolean;
    archive?: string;
    part?: BundleManifestPart;
    message?: string;
  }>;
  extractOne: (payload: {
    partId: string;
    targetDir: string;
  }) => Promise<{ ok: boolean; message: string; targetDir: string }>;
  onProgress: (
    handler: (p: { partId: string; percent: number; message: string }) => void
  ) => () => void;
};


const GB = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/**
 * Deploy panel.
 *
 * props.onChange fires after every part changes state so the outer
 * environment check can re-run.
 */
export function ModuleDeployPanel({
  targetDir,
  onTargetDir,
  onChange,
}: {
  targetDir: string | null;
  onTargetDir: (dir: string) => void;
  onChange: () => void;
}) {
  const t = useTranslations('Onboarding');
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [state, setState] = useState<ModuleInspect | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<BundleManifestPart | null>(null);

  const api = typeof window === 'undefined' ? undefined : window.mankeDesktop;

  // Load the manifest and the current per-part state.
  const refresh = useCallback(async () => {
    if (!api || !targetDir) return;
    const m = await api.modules.manifest();
    setManifest(m);
    if (m) setState(await api.modules.inspect({ targetDir, manifest: m }));
  }, [api, targetDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pickTarget = useCallback(async () => {
    if (!api) return;
    const picked = await api.bundle.pickTarget();
    if (picked.ok && picked.dir) {
      onTargetDir(picked.dir);
    }
  }, [api, onTargetDir]);

  // Extract the next pending part.
  const extractNext = useCallback(async () => {
    if (!api || !targetDir || !state?.next) return;
    const part = state.next;

    setBusy(true);
    setPercent(0);
    setNote(`${t('moduleExtracting')} ${part.name}`);

    const stop = api.modules.onProgress((p) => {
      if (p.partId !== part.id) return;
      setPercent(p.percent ?? 0);
      if (p.message) setNote(p.message);
    });

    try {
      const result = await api.modules.extractOne({ partId: part.id, targetDir });
      setMessage(result.message);
      if (result.ok) {
        setJustDone(part);
        onChange();
      }
      await refresh();
    } finally {
      stop();
      setBusy(false);
      setPercent(0);
      setNote('');
    }
  }, [api, targetDir, state, refresh, onChange, t]);

  // Walk the remaining parts in one go.
  const extractAll = useCallback(async () => {
    if (!api || !targetDir || !state) return;
    setBusy(true);
    for (const part of state.pending) {
      setPercent(0);
      setNote(`${t('moduleExtracting')} ${part.name}`);
      const stop = api.modules.onProgress((p) => {
        if (p.partId !== part.id) return;
        setPercent(p.percent ?? 0);
        if (p.message) setNote(p.message);
      });
      try {
        const result = await api.modules.extractOne({ partId: part.id, targetDir });
        if (!result.ok) {
          setMessage(result.message);
          stop();
          setBusy(false);
          await refresh();
          return;
        }
        setJustDone(part);
        onChange();
      } finally {
        stop();
      }
      await refresh();
    }
    setBusy(false);
    setPercent(0);
    setNote('');
    setMessage(t('moduleAllDone'));
  }, [api, targetDir, state, refresh, onChange, t]);

  if (!api) return null;

  // No target chosen yet.
  if (!targetDir) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-[var(--beat-line)] p-3">
        <p className="text-[12px] font-medium text-[var(--beat-text-2)]">{t('moduleTitle')}</p>
        <p className="mt-1 text-[11px] leading-5 text-[var(--beat-text-3)]">{t('moduleIntro')}</p>
        <button
          type="button"
          onClick={() => void pickTarget()}
          className="mt-2 rounded-full bg-[var(--beat-accent)] px-4 py-2 text-[12px] font-medium text-white transition hover:opacity-90"
        >
          {t('modulePickTarget')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--beat-line)] p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-medium text-[var(--beat-text-2)]">{t('moduleTitle')}</p>
        {state ? (
          <p className="text-[11px] text-[var(--beat-text-3)]">
            {state.doneCount}/{state.total} {t('moduleParts')}
          </p>
        ) : null}
      </div>

      <p className="mt-1 truncate text-[11px] text-[var(--beat-text-3)]" title={targetDir}>
        {t('moduleTarget')} {targetDir}
      </p>

      {/* Progress */}
      {busy ? (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--beat-line)]">
            <div
              className="h-full rounded-full bg-[var(--beat-accent)] transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 truncate text-[11px] text-[var(--beat-text-3)]" title={note}>
            {percent}% · {note}
          </p>
        </div>
      ) : null}

      {/* Just-finished part: name the archive that can be deleted */}
      {justDone && !busy ? (
        <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
          <p className="text-[12px] font-medium text-emerald-800">
            {justDone.name} {t('moduleDone')}
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-700">
            {t('moduleCanDelete')} <span className="font-mono">{justDone.file}</span>（
            {GB(justDone.bytes)} GB）
          </p>
        </div>
      ) : null}

      {/* Part list */}
      {manifest && state ? (
        <ul className="mt-2 flex flex-col gap-1">
          {manifest.parts.map((part) => {
            const done = state.done.includes(part.id);
            const isNext = state.next?.id === part.id;
            return (
              <li
                key={part.id}
                className={[
                  'flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px]',
                  done
                    ? 'bg-emerald-50 text-emerald-800'
                    : isNext
                      ? 'bg-[var(--beat-accent-soft)] text-[var(--beat-accent-ink)]'
                      : 'text-[var(--beat-text-3)]',
                ].join(' ')}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span className="w-4 shrink-0 text-center" aria-hidden="true">
                    {done ? '✓' : isNext ? '→' : '·'}
                  </span>
                  <span className="truncate">{part.name}</span>
                </span>
                <span className="shrink-0 pl-2 tabular-nums">{GB(part.bytes)} GB</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {message ? (
        <p className="mt-2 rounded-lg bg-[var(--beat-surface)] px-3 py-2 text-[11px] leading-5 text-[var(--beat-text-2)]">
          {message}
        </p>
      ) : null}

      {/* Actions */}
      <div className="mt-2 flex flex-wrap gap-2">
        {state?.next && !state.complete ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void extractNext()}
            className="rounded-full bg-[var(--beat-accent)] px-4 py-2 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {t('moduleExtractNext')}（{state.next.name}）
          </button>
        ) : null}
        {state && state.pending.length > 1 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void extractAll()}
            className="rounded-full border border-[var(--beat-line)] px-4 py-2 text-[12px] text-[var(--beat-text-2)] transition hover:border-[var(--beat-accent)] disabled:opacity-50"
          >
            {t('moduleExtractAll')}（{state.pending.length}）
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void pickTarget()}
          className="rounded-full px-3 py-2 text-[11px] text-[var(--beat-text-3)] transition hover:text-[var(--beat-text-1)] disabled:opacity-50"
        >
          {t('moduleChangeTarget')}
        </button>
      </div>
    </div>
  );
}

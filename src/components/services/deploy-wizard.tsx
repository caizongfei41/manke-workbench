'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  Package,
  RefreshCw,
} from 'lucide-react';

import { m } from '@/paraglide/messages.js';

/**
 * Deploy wizard: download, verify, extract, done.
 *
 * The problem it solves is concrete. A fresh machine has to install ComfyUI,
 * get a Python environment, pull 197 GB of weights, and extract them into three
 * different directories -- and any mistake along the way is hard to diagnose.
 * This panel folds those four steps into one surface, and every step reads its
 * answer from disk rather than guessing.
 *
 * Progress comes from polling /api/app/deploy: extraction runs 40+ minutes, far
 * too long to hold a request open.
 */

type VolumeSet = {
  base: string;
  volumes: string[];
  count: number;
  bytes: number;
  complete: boolean;
  missing: number[];
};

type Inspect = {
  bundleDir: string;
  archiveBase: string;
  target: string;
  sevenZip: string | null;
  freeBytes: number | null;
  volumes: VolumeSet;
  legacyBundles: string[];
  estimatedExtractBytes: number;
};

type Progress = {
  running: boolean;
  stage: string;
  detail: string;
  percent: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

type DeployResponse = {
  bundleDir: string;
  inspect: Inspect | null;
  inspectError: string | null;
  progress: Progress | null;
};

const human = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
};

const STEPS = [
  { id: 'download', label: () => m['services.deploy.stepDownload']() },
  { id: 'inspect', label: () => m['services.deploy.stepInspect']() },
  { id: 'extract', label: () => m['services.deploy.stepExtract']() },
  { id: 'done', label: () => m['services.deploy.stepDone']() },
] as const;

export function DeployWizard() {
  const [bundleDir, setBundleDir] = useState('');
  const [comfyDir, setComfyDir] = useState('');
  const [data, setData] = useState<DeployResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (bundleDir) params.set('bundle', bundleDir);
      if (comfyDir) params.set('comfy', comfyDir);
      const res = await fetch(`/api/app/deploy?${params.toString()}`, {
        headers: { 'x-beatapi-workspace-request': '1' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DeployResponse;
      setData(json);
      if (json.inspect?.bundleDir) setBundleDir((prev) => prev || json.inspect!.bundleDir);
      // The inspect payload calls the extraction destination "target", not
      // "comfyRoot" -- that name only existed in the old four-bundle layout.
      if (json.inspect?.target) setComfyDir((prev) => prev || json.inspect!.target);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [bundleDir, comfyDir]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a deploy is running; idle pages should stay quiet.
  useEffect(() => {
    const running = data?.progress?.running;
    if (!running) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void load();
    }, 2500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [data?.progress?.running, load]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/app/deploy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1' },
        body: JSON.stringify({ bundle: bundleDir, comfy: comfyDir }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const inspect = data?.inspect ?? null;
  const progress = data?.progress ?? null;

  // The deploy script now ships one archive stream split into N volumes
  // (manke-bundle.7z.001 …) instead of four category bundles. Reading
  // inspect.bundles here used to throw "Cannot read properties of undefined
  // (reading 'filter')" and blank the whole page, because the optional chain
  // guards inspect but not the property under it.
  const volumeSet = inspect?.volumes ?? null;
  const volumesFound = volumeSet?.count ?? 0;
  const volumesComplete = Boolean(volumeSet?.complete);
  const missingVolumes = volumeSet?.missing ?? [];
  const totalBytes = volumeSet?.bytes ?? 0;
  const freeBytes = inspect?.freeBytes ?? null;
  const enoughSpace = freeBytes === null || freeBytes > totalBytes * 1.05;
  const ready =
    Boolean(inspect?.sevenZip) && volumesComplete && Boolean(comfyDir) && enoughSpace;
  const deployed = progress?.stage === 'done';

  // Which step the wizard is on.
  const stepIndex = progress?.running
    ? 2
    : deployed
      ? 3
      : ready
        ? 1
        : volumesFound === 0 || !volumesComplete
          ? 0
          : 1;

  return (
    <section className="rounded-[18px] border border-[var(--beat-border)] bg-[var(--beat-surface)] p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--beat-accent)]/12 text-[var(--beat-accent)]">
          <HardDriveDownload className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-[var(--beat-text-1)]">{m['services.deploy.title']()}</h2>
          <p className="mt-0.5 text-[13px] text-[var(--beat-text-2)]">
            {m['services.deploy.subtitle']()}
          </p>
        </div>
      </header>

      {/* Step rail */}
      <ol className="mb-4 flex items-center gap-1.5 text-[12.5px]">
        {STEPS.map((step, i) => {
          const state = i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'todo';
          return (
            <li key={step.id} className="flex flex-1 items-center gap-1.5">
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                  state === 'done'
                    ? 'bg-[var(--beat-accent)] text-[var(--beat-accent-ink)]'
                    : state === 'active'
                      ? 'bg-[var(--beat-accent)]/18 text-[var(--beat-accent)]'
                      : 'bg-[var(--beat-control)] text-[var(--beat-text-3)]'
                }`}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span
                className={
                  state === 'todo'
                    ? 'text-[var(--beat-text-3)]'
                    : 'font-medium text-[var(--beat-text-1)]'
                }
              >
                {step.label()}
              </span>
              {i < STEPS.length - 1 && (
                <span className="h-px flex-1 bg-[var(--beat-border)]" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      {/* Step 1: where to get it */}
      {stepIndex === 0 && (
        <div className="mb-4 rounded-[12px] border border-[var(--beat-accent)]/30 bg-[var(--beat-accent)]/[0.06] p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--beat-text-1)]">
            <Download className="size-4 text-[var(--beat-accent)]" />
            {m['services.deploy.downloadTitle']()}
          </p>
          <a
            href="https://pan.quark.cn/s/8d1ed42563d4"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--beat-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--beat-accent-ink)]"
          >
            {m['services.deploy.openQuark']()}
          </a>
          <p className="mt-2 text-[12.5px] leading-5 text-[var(--beat-text-2)]">
            {m['services.deploy.downloadHint']({ code: '~9d1f3bt6QP~:/' })}
          </p>
        </div>
      )}

      {/* Paths */}
      <div className="mb-4 grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[12.5px] text-[var(--beat-text-2)]">
            <Package className="size-3.5" /> {m['services.deploy.bundleDir']()}
          </span>
          <input
            value={bundleDir}
            onChange={(e) => setBundleDir(e.target.value)}
            placeholder="D:\manke-deploy"
            className="h-9 w-full rounded-[8px] border border-[var(--beat-border)] bg-[var(--beat-control)] px-2.5 text-[13px] text-[var(--beat-text-1)] outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-[12.5px] text-[var(--beat-text-2)]">
            <FolderOpen className="size-3.5" /> {m['services.deploy.installTo']()}
          </span>
          <input
            value={comfyDir}
            onChange={(e) => setComfyDir(e.target.value)}
            placeholder="D:\ComfyUI"
            className="h-9 w-full rounded-[8px] border border-[var(--beat-border)] bg-[var(--beat-control)] px-2.5 text-[13px] text-[var(--beat-text-1)] outline-none"
          />
        </label>
      </div>

      {/* Bundle state */}
      {loading ? (
        <p className="flex items-center gap-2 py-3 text-[13px] text-[var(--beat-text-2)]">
          <Loader2 className="size-4 animate-spin" /> {m['services.deploy.checking']()}
        </p>
      ) : inspect ? (
        <ul className="mb-4 space-y-1.5">
          {/* One row for the whole volume set: the archive is a single stream
              split into manke-bundle.7z.001 … so per-category rows no longer
              exist. */}
          <li className="flex items-center gap-2 rounded-[8px] bg-[var(--beat-control)] px-2.5 py-1.5 text-[13px]">
            {volumesComplete ? (
              <CheckCircle2 className="size-4 shrink-0 text-[var(--beat-accent)]" />
            ) : (
              <AlertCircle className="size-4 shrink-0 text-[var(--beat-warn-text)]" />
            )}
            <span className="min-w-0 flex-1 truncate text-[var(--beat-text-1)]">
              {m['services.deploy.bundleVolumes']()}
            </span>
            <span className="shrink-0 text-[12px] text-[var(--beat-text-3)]">
              {volumesFound > 0
                ? `${volumesFound} × ${human(totalBytes)}${
                    volumesComplete
                      ? ''
                      : ` · ${m['services.deploy.missingVolumes']({
                          volumes: missingVolumes.join(','),
                        })}`
                  }`
                : m['services.deploy.missing']()}
            </span>
          </li>
          {/* Free space on the target drive decides whether a 210 GB extract
              can even start, so surface it next to the bundle state. */}
          {freeBytes !== null && volumesFound > 0 && (
            <li className="flex items-center gap-2 rounded-[8px] bg-[var(--beat-control)] px-2.5 py-1.5 text-[13px]">
              {enoughSpace ? (
                <CheckCircle2 className="size-4 shrink-0 text-[var(--beat-accent)]" />
              ) : (
                <AlertCircle className="size-4 shrink-0 text-[var(--beat-warn-text)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-[var(--beat-text-1)]">
                {m['services.deploy.freeSpace']()}
              </span>
              <span className="shrink-0 text-[12px] text-[var(--beat-text-3)]">
                {human(freeBytes)}
              </span>
            </li>
          )}
        </ul>
      ) : (
        <p className="mb-4 rounded-[8px] bg-[var(--beat-warn-text)]/10 px-3 py-2 text-[13px] text-[var(--beat-warn-text)]">
          {data?.inspectError ?? m['services.deploy.checkFailed']()}
        </p>
      )}

      {/* Progress */}
      {progress && (progress.running || progress.stage === 'done' || progress.error) && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
            <span className="text-[var(--beat-text-2)]">{progress.detail || progress.stage}</span>
            <span className="tabular-nums text-[var(--beat-text-3)]">{progress.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--beat-control)]">
            <div
              className={`h-full rounded-full transition-all ${
                progress.error ? 'bg-[var(--beat-warn-text)]' : 'bg-[var(--beat-accent)]'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
            />
          </div>
          {progress.error && (
            <p className="mt-1.5 text-[12.5px] text-[var(--beat-warn-text)]">{progress.error}</p>
          )}
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-[8px] bg-[var(--beat-warn-text)]/10 px-3 py-2 text-[13px] text-[var(--beat-warn-text)]">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || progress?.running}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--beat-border)] px-3 text-[13px] text-[var(--beat-text-2)] disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" /> {m['services.deploy.recheck']()}
        </button>
        <button
          type="button"
          onClick={() => void start()}
          disabled={!ready || starting || progress?.running}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--beat-accent)] px-4 text-[13px] font-medium text-[var(--beat-accent-ink)] disabled:opacity-40"
        >
          {progress?.running || starting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> {m['services.deploy.running']()}
            </>
          ) : deployed ? (
            <>
              <CheckCircle2 className="size-3.5" /> {m['services.deploy.finished']()}
            </>
          ) : (
            <>
              <HardDriveDownload className="size-3.5" /> {m['services.deploy.start']()}
            </>
          )}
        </button>
        <span className="text-[12.5px] text-[var(--beat-text-3)]">
          {m['services.deploy.total']({ size: human(totalBytes) })}
        </span>
      </div>
    </section>
  );
}

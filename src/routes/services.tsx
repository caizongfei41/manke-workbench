import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  Play,
  Power,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { EnvironmentPanel } from '@/components/services/environment-panel';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';

interface ServiceStatus {
  id: string;
  label: string;
  port: number;
  up: boolean;
  url: string;
  detail?: string;
}

interface ServicesPayload {
  services: ServiceStatus[];
  comfyUiRoot: string;
  comfyUiPython: string;
  llamaManaged: boolean;
  comfyUiLog?: string;
}

const POLL_MS = 5000;
/** Faster cadence used while a start/stop is still settling. */
const FAST_POLL_MS = 1500;
/** Longest we keep showing "starting"/"stopping" before falling back to reality. */
const MAX_PENDING_MS = 180000;

async function fetchStatus(): Promise<ServicesPayload> {
  return apiJsonGet<ServicesPayload>('/api/app/services');
}

function ServiceCard({
  svc,
  pending,
  onAct,
}: {
  svc: ServiceStatus;
  pending: string | null;
  onAct: (service: string, action: 'start' | 'stop') => void;
}) {
  const dotColor = svc.up
    ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]'
    : 'bg-[var(--beat-text-3)]';
  const dotLabel = svc.up
    ? m['services.statusRunning']()
    : m['services.statusStopped']();

  return (
    <div className="flex flex-col rounded-[var(--beat-radius)] border border-ink/[0.08] bg-ink/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex size-2.5">
            <span className={`absolute inline-flex size-full rounded-full ${dotColor}`} />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[var(--beat-text-1)]">
              {svc.label}
            </div>
            <div className="mt-0.5 text-xs text-[var(--beat-text-3)]">
              {svc.detail || `127.0.0.1:${svc.port}`}
            </div>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            svc.up
              ? 'bg-emerald-400/10 text-emerald-300'
              : 'bg-ink/[0.06] text-[var(--beat-text-3)]'
          }`}
        >
          {pending === 'starting' && !svc.up
            ? m['services.statusStarting']()
            : pending === 'stopping' && svc.up
              ? m['services.statusStopping']()
              : dotLabel}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {svc.id !== 'workbench' && (
          <>
            <button
              type="button"
              disabled={!!pending}
              onClick={() => onAct(svc.id, svc.up ? 'stop' : 'start')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition disabled:opacity-40 ${
                svc.up
                  ? 'border border-ink/[0.12] bg-ink/[0.05] text-[var(--beat-text-2)] hover:bg-ink/[0.1]'
                  : 'bg-[var(--beat-accent)] text-[var(--beat-accent-ink)] hover:brightness-110'
              }`}
            >
              {svc.up ? (
                <>
                  <Power className="size-3.5" />
                  {m['services.stop']()}
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  {m['services.start']()}
                </>
              )}
            </button>
            <span className="text-xs text-[var(--beat-text-3)]">
              {svc.port}
            </span>
          </>
        )}
        {svc.id === 'workbench' && (
          <span className="text-xs text-[var(--beat-text-3)]">
            {svc.port} · {m['services.workbenchDetail']()}
          </span>
        )}
        <a
          href={svc.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-ink/[0.1] bg-ink/[0.04] px-3 text-xs font-medium text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] hover:text-ink"
        >
          {m['services.open']()}
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/services')({
  component: ServicesRouteComponent,
});

function ServicesRouteComponent() {
  const [data, setData] = useState<ServicesPayload | null>(null);
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const refreshingRef = useRef(false);
  const pendingSinceRef = useRef(0);

  const refresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const payload = await fetchStatus();
      setData(payload);
      setLog(payload.comfyUiLog ?? '');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      refreshingRef.current = false;
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll faster while a start/stop is still settling: ComfyUI needs ~30s to come
  // up, and a 5s cadence makes the page look frozen for the whole wait.
  const hasPending = Object.values(pending).some(Boolean);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), hasPending ? FAST_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending]);

  // Clear a pending action only once the service actually reports the state we
  // asked for. The previous version stopped showing "starting" as soon as the
  // POST returned, leaving the card reading "stopped" for the whole boot.
  useEffect(() => {
    if (!data) return;
    setPending((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const svc of data.services) {
        const want = prev[svc.id];
        if (want === 'starting' && svc.up) {
          next[svc.id] = null;
          changed = true;
        } else if (want === 'stopping' && !svc.up) {
          next[svc.id] = null;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  // Give up waiting for a start/stop that never settles, so the faster poll
  // cannot spin forever. A cold ComfyUI start is the slow case (~30-60s).
  useEffect(() => {
    if (!hasPending) {
      pendingSinceRef.current = 0;
      return;
    }
    if (!pendingSinceRef.current) pendingSinceRef.current = Date.now();
    const remaining = Math.max(
      1000,
      MAX_PENDING_MS - (Date.now() - pendingSinceRef.current)
    );
    const timer = setTimeout(() => setPending({}), remaining);
    return () => clearTimeout(timer);
  }, [hasPending]);

  const act = async (service: string, action: 'start' | 'stop') => {
    setPending((prev) => ({
      ...prev,
      [service]: action === 'start' ? 'starting' : 'stopping',
    }));
    try {
      await apiJsonPost('/api/app/services', { service, action });
      // Ask once right away; the faster interval above carries the rest.
      setTimeout(() => void refresh(), 1200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending((prev) => ({ ...prev, [service]: null }));
    }
  };

  const services = data?.services ?? [];

  return (
    <div className="beat-product-shell flex min-h-screen flex-col bg-[var(--beat-bg)] text-[var(--beat-text-1)]">
      <header className="sticky top-0 z-40 border-b border-ink/[0.07] bg-[var(--beat-surface)]/96 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-5">
          <Link
            href="/"
            aria-label={m['common.pages.back_to_home']()}
            className="inline-flex size-9 items-center justify-center rounded-xl text-[var(--beat-text-1)] transition hover:bg-ink/[0.06]"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-[15px] font-semibold">
            {m['services.title']()}
          </h1>
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto inline-flex size-9 items-center justify-center rounded-xl border border-ink/[0.09] bg-ink/[0.035] text-[var(--beat-text-2)] transition hover:bg-ink/[0.075] hover:text-ink"
            aria-label={m['services.refresh']()}
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[880px] flex-1 px-4 py-6 lg:px-5">
        <p className="mb-5 text-sm leading-6 text-[var(--beat-text-2)]">
          {m['services.subtitle']()}
        </p>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((svc) => (
            <ServiceCard
              key={svc.id}
              svc={svc}
              pending={pending[svc.id] ?? null}
              onAct={act}
            />
          ))}
          {services.length === 0 ? (
            <div className="rounded-[var(--beat-radius)] border border-ink/[0.08] bg-ink/[0.03] p-5 text-sm text-[var(--beat-text-3)]">
              Loading…
            </div>
          ) : null}
        </div>

        {data?.comfyUiRoot ? (
          <div className="mt-4 rounded-[var(--beat-radius)] border border-ink/[0.07] bg-ink/[0.02] px-4 py-3 text-xs leading-5 text-[var(--beat-text-3)]">
            ComfyUI {m['services.comfyRoot']()}：{data.comfyUiRoot}
            <br />
            {m['services.python']()}：{data.comfyUiPython}
          </div>
        ) : null}

        <EnvironmentPanel />

        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--beat-text-2)]">
            <TerminalSquare className="size-4" />
            {m['services.logTitle']()}
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-[var(--beat-radius)] border border-ink/[0.08] bg-[var(--beat-panel)] p-4 text-xs leading-5 text-zinc-400">
            {log || m['services.logEmpty']()}
          </pre>
        </div>
      </main>
    </div>
  );
}

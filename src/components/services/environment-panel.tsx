import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { apiJsonGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';

/**
 * Environment readiness panel.
 *
 * Answers "can this machine actually run the bundled templates?" — node packages,
 * model files, build output, ComfyUI reachability. The verdict comes from
 * /api/app/environment, which runs the same script the desktop service console
 * calls, so both places never disagree.
 */

type CheckStatus = 'pass' | 'warn' | 'fail';

interface EnvCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

interface EnvPayload {
  ok: boolean;
  summary: { pass: number; warn: number; fail: number };
  checks: EnvCheck[];
}

const ICON: Record<CheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
};

const TONE: Record<CheckStatus, string> = {
  pass: 'text-emerald-400',
  warn: 'text-amber-400',
  fail: 'text-red-400',
};

export function EnvironmentPanel() {
  const [data, setData] = useState<EnvPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiJsonGet<EnvPayload>('/api/app/environment');
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  // Run once on mount: this page is usually opened to answer exactly that question.
  useEffect(() => {
    void run();
  }, [run]);

  const summary = data?.summary;
  const ready = Boolean(data?.ok);

  return (
    <section className="mt-6 rounded-[var(--beat-radius)] border border-ink/[0.08] bg-ink/[0.02] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="size-4 text-[var(--beat-text-2)]" />
        <h2 className="text-sm font-semibold">{m['services.envTitle']()}</h2>

        {summary ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              ready
                ? 'border-[var(--beat-success-text)]/30 bg-[var(--beat-success-bg)] text-[var(--beat-success-text)]'
                : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
            }`}
          >
            {m['services.envSummary']({
              pass: String(summary.pass),
              warn: String(summary.warn),
              fail: String(summary.fail),
            })}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-ink/[0.09] bg-ink/[0.035] px-3 py-1.5 text-xs text-[var(--beat-text-2)] transition hover:bg-ink/[0.075] hover:text-ink disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {loading ? m['services.envChecking']() : m['services.envRecheck']()}
        </button>
      </div>

      <p className="mt-2 text-xs leading-5 text-[var(--beat-text-3)]">
        {m['services.envSubtitle']()}
      </p>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : null}

      {data && data.checks.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {data.checks.map((check) => {
            const Icon = ICON[check.status];
            return (
              <li key={check.id} className="flex items-start gap-2 text-xs">
                <Icon className={`mt-0.5 size-3.5 shrink-0 ${TONE[check.status]}`} />
                <span className="w-[104px] shrink-0 text-[var(--beat-text-3)]">
                  {check.label}
                </span>
                <span className="min-w-0 flex-1 text-[var(--beat-text-2)]">
                  {check.detail}
                  {check.hint && check.status !== 'pass' ? (
                    <span className="mt-0.5 block text-[var(--beat-text-3)]">
                      → {check.hint}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {data ? (
        <p
          className={`mt-4 text-xs ${ready ? 'text-[var(--beat-success-text)]' : 'text-amber-600'}`}
        >
          {ready ? m['services.envReady']() : m['services.envNotReady']()}
        </p>
      ) : !loading && !error ? (
        <p className="mt-4 text-xs text-[var(--beat-text-3)]">
          {m['services.envIdle']()}
        </p>
      ) : null}
    </section>
  );
}

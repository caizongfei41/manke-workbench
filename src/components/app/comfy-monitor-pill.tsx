import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Loader2, Play, Square } from 'lucide-react';

import type { ComfyMonitor } from '@/core/app/comfy-monitor';
import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';
import {
  WORKSPACE_MUTATION_HEADER,
  WORKSPACE_MUTATION_HEADER_VALUE,
} from '@/lib/trusted-local-request';

/**
 * Live queue and VRAM in the header.
 *
 * A long render gives no feedback about whether the card is full or the queue is
 * backed up; this is the smallest thing that answers "why is it not moving".
 * Polls while the tab is visible and stops when it is not.
 *
 * It also starts and stops the service. Showing "not connected" with no way to
 * act on it just sent people hunting through the service console for a button
 * that could have been right here.
 */

const POLL_MS = 5000;

/** How long to wait before re-checking after a start: models take time to load */
const START_SETTLE_MS = 4000;

export function ComfyMonitorPill({ className }: { className?: string }) {
  const [monitor, setMonitor] = useState<ComfyMonitor | null>(null);
  const [toggling, setToggling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const fetchMonitor = useCallback(async () => {
    const res = await fetch('/api/app/comfyui/monitor').catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!cancelledRef.current && json) setMonitor(json as ComfyMonitor);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    const poll = async (force = false) => {
      if (!force && document.visibilityState !== 'visible') return;
      await fetchMonitor();
    };

    void poll(true);
    timerRef.current = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => void poll(true);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchMonitor]);

  const toggleService = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
    const reachable = monitor?.reachable === true;
    try {
      await fetch('/api/app/services', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE,
        },
        body: JSON.stringify({
          service: 'comfyui',
          action: reachable ? 'stop' : 'start',
        }),
      });
      // Stop is synchronous; start needs a moment or the check still reads offline
      if (!reachable) {
        await new Promise((resolve) => setTimeout(resolve, START_SETTLE_MS));
      }
      await fetchMonitor();
    } catch {
      /* the next poll brings the real state back */
    } finally {
      if (!cancelledRef.current) setToggling(false);
    }
  }, [monitor?.reachable, toggling, fetchMonitor]);

  const pending = monitor === null;
  const vramFull =
    monitor?.vramUsedGb !== null &&
    monitor?.vramTotalGb !== null &&
    (monitor?.vramTotalGb ?? 0) > 0 &&
    (monitor?.vramUsedGb ?? 0) / (monitor?.vramTotalGb ?? 1) > 0.9;
  const busy = (monitor?.running ?? 0) > 0 || (monitor?.pending ?? 0) > 0;

  const label = pending
    ? m['monitor.checking']()
    : monitor.reachable
      ? [
          busy
            ? m['monitor.queue']({ running: monitor.running, pending: monitor.pending })
            : m['monitor.idle'](),
          monitor.vramUsedGb !== null && monitor.vramTotalGb !== null
            ? m['monitor.vram']({ used: monitor.vramUsedGb, total: monitor.vramTotalGb })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : m['monitor.offline']();

  const reachable = monitor?.reachable === true;

  return (
    <div
      title={[
        monitor?.device ?? '',
        monitor?.ramUsedGb !== null &&
        monitor?.ramUsedGb !== undefined &&
        monitor?.ramTotalGb !== null &&
        monitor?.ramTotalGb !== undefined
          ? m['monitor.ram']({ used: monitor.ramUsedGb, total: monitor.ramTotalGb })
          : '',
        monitor?.version ? `ComfyUI ${monitor.version}` : '',
      ]
        .filter(Boolean)
        .join('\n')}
      data-comfy-monitor={pending ? 'pending' : reachable ? 'live' : 'offline'}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border pl-2.5 pr-1 text-[13px] tabular-nums transition',
        pending
          ? 'border-ink/[0.09] bg-ink/[0.035] text-[var(--beat-text-3)]'
          : reachable
            ? vramFull
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-ink/[0.09] bg-ink/[0.035] text-[var(--beat-text-2)]'
            : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
        className
      )}
    >
      <Activity className={cn('size-3.5', busy && 'animate-pulse')} />
      <span className="hidden sm:inline">{label}</span>
      <button
        type="button"
        disabled={pending || toggling}
        onClick={() => void toggleService()}
        aria-label={reachable ? m['monitor.stop']() : m['monitor.start']()}
        title={reachable ? m['monitor.stop']() : m['monitor.start']()}
        data-comfy-toggle={reachable ? 'stop' : 'start'}
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-lg transition hover:bg-ink/[0.09] disabled:opacity-40',
          reachable ? 'text-[var(--beat-text-3)]' : 'text-red-600 dark:text-red-300'
        )}
      >
        {toggling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : reachable ? (
          <Square className="size-3 fill-current" />
        ) : (
          <Play className="size-3.5 fill-current" />
        )}
      </button>
    </div>
  );
}

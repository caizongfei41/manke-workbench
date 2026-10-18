import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';

import type { ComfyMonitor } from '@/core/app/comfy-monitor';
import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';

/**
 * Live queue and VRAM in the header.
 *
 * A long render gives no feedback about whether the card is full or the queue is
 * backed up; this is the smallest thing that answers "why is it not moving".
 * Polls while the tab is visible and stops when it is not.
 */

const POLL_MS = 5000;

export function ComfyMonitorPill({ className }: { className?: string }) {
  const [monitor, setMonitor] = useState<ComfyMonitor | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await fetch('/api/app/comfyui/monitor').catch(() => null);
      const json = await res?.json().catch(() => null);
      if (!cancelled && json) setMonitor(json as ComfyMonitor);
    };

    void poll();
    timerRef.current = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!monitor) return null;

  const vramFull =
    monitor.vramUsedGb !== null &&
    monitor.vramTotalGb !== null &&
    monitor.vramTotalGb > 0 &&
    monitor.vramUsedGb / monitor.vramTotalGb > 0.9;
  const busy = monitor.running > 0 || monitor.pending > 0;

  const label = monitor.reachable
    ? [
        busy ? m['monitor.queue']({ running: monitor.running, pending: monitor.pending }) : m['monitor.idle'](),
        monitor.vramUsedGb !== null && monitor.vramTotalGb !== null
          ? m['monitor.vram']({ used: monitor.vramUsedGb, total: monitor.vramTotalGb })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : m['monitor.offline']();

  return (
    <div
      title={[
        monitor.device ?? '',
        monitor.ramUsedGb !== null && monitor.ramTotalGb !== null
          ? m['monitor.ram']({ used: monitor.ramUsedGb, total: monitor.ramTotalGb })
          : '',
        monitor.version ? `ComfyUI ${monitor.version}` : '',
      ]
        .filter(Boolean)
        .join('\n')}
      data-comfy-monitor={monitor.reachable ? 'live' : 'offline'}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] tabular-nums transition',
        monitor.reachable
          ? vramFull
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            : 'border-ink/[0.09] bg-ink/[0.035] text-[var(--beat-text-2)]'
          : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
        className
      )}
    >
      <Activity className={cn('size-3.5', busy && 'animate-pulse')} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

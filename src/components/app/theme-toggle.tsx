import { Monitor, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { HintTip } from '@/components/app/hint-tip';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Must match the key used by the pre-paint script in __root.tsx. */
const STORAGE_KEY = 'manke-theme';

const isMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system';

const systemTheme = (): ResolvedTheme =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';

const applyTheme = (mode: ThemeMode) => {
  const resolved: ResolvedTheme = mode === 'system' ? systemTheme() : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
};

/**
 * Theme state, persisted in localStorage.
 *
 * `system` is a first-class option rather than "no preference": users who have
 * the OS switching at dusk expect the app to follow without touching it again.
 * The pre-paint script in __root.tsx reads the same key, so the stored value
 * never causes a flash.
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('dark');

  // Adopt whatever the pre-paint script already decided, then keep in sync.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const initial: ThemeMode = isMode(stored) ? stored : 'system';
    setModeState(initial);
    setResolved(applyTheme(initial));
  }, []);

  // Follow the OS while the mode is `system`.
  useEffect(() => {
    if (mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setResolved(applyTheme('system'));
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    setResolved(applyTheme(next));
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode with storage disabled: the in-memory choice still applies.
    }
  }, []);

  return { mode, resolved, setMode };
}

const OPTIONS: Array<{
  value: ThemeMode;
  icon: typeof Sun;
  labelKey: 'theme.light' | 'theme.dark' | 'theme.system';
}> = [
  { value: 'light', icon: Sun, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'theme.dark' },
  { value: 'system', icon: Monitor, labelKey: 'theme.system' },
];

/**
 * Three-way theme switch. Icons only, with a hover hint, so it fits the top bar
 * next to the language switcher without stealing width from the nav tabs.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label={m['theme.label']()}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-ink/[0.09] bg-ink/[0.035] p-0.5',
        className
      )}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        return (
          <HintTip key={option.value} label={m[option.labelKey]()}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={m[option.labelKey]()}
              onClick={() => setMode(option.value)}
              className={cn(
                'grid size-7 place-items-center rounded-full transition',
                active
                  ? 'bg-ink/[0.12] text-ink shadow-[inset_0_0_0_1px_rgba(127,127,127,0.22)]'
                  : 'text-[var(--beat-text-3)] hover:bg-ink/[0.06] hover:text-[var(--beat-text-1)]'
              )}
            >
              <Icon className="size-3.5" />
            </button>
          </HintTip>
        );
      })}
    </div>
  );
}

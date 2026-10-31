import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Command, CornerDownLeft, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';

/**
 * `/` or Ctrl/Cmd-K opens a palette over navigation and saved projects.
 *
 * The board has a fixed set of columns and the project list is a wall of cards, so
 * "where is that film again" was a scroll hunt. Typing three characters beats both.
 *
 * Portalled to `body`: workspace pages render inside a scaled canvas transform, and a
 * palette inside it would shrink with the zoom.
 */

type Command = {
  id: string;
  label: string;
  hint?: string;
  keywords: string[];
  run: () => void;
};

// Paraglide message keys are strongly typed, so they cannot be built by
// concatenation; list the four modes explicitly.
const MODE_LABELS = {
  studio: m['cmd.mode.studio'],
  canvas: m['cmd.mode.canvas'],
  editor: m['cmd.mode.editor'],
  assets: m['cmd.mode.assets'],
};

const modePath = (projectId: string, mode: string | undefined) => {
  if (mode === 'canvas') return `/canvas/${projectId}`;
  if (mode === 'editor') return `/editor/${projectId}`;
  if (mode === 'assets') return `/assets/${projectId}`;
  return `/studio/${projectId}`;
};

type ProjectRow = {
  id: string;
  name: string;
  lastWorkspaceMode?: string | null;
};

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  // Load the project list the first time the palette opens.
  useEffect(() => {
    if (!open || projects !== null) return;
    void fetch('/api/app/projects')
      .then((res) => res.json())
      .catch(() => null)
      .then((json) => setProjects(Array.isArray(json?.projects) ? json.projects.slice(0, 30) : []));
  }, [open, projects]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      close();
      void navigate({ to: path });
    };
    const nav: Command[] = [
      { id: 'home', label: m['cmd.home'](), keywords: ['home', 'index'], run: go('/') },
      {
        id: 'standard',
        label: m['cmd.standard'](),
        keywords: ['standard', 'canvas', 'board', 'node'],
        run: () => {
          close();
          const newest = projects?.[0]?.id;
          void navigate({ to: newest ? `/standard/${newest}` : '/projects' });
        },
      },
  { id: 'projects', label: m['cmd.projects'](), keywords: ['projects', 'list'], run: go('/projects') },
      { id: 'services', label: m['cmd.services'](), keywords: ['services', 'status'], run: go('/services') },
      { id: 'new', label: m['cmd.newProject'](), keywords: ['new', 'create'], run: go('/projects') },
    ];

    const rows: Command[] = (projects ?? []).map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      hint: MODE_LABELS[(project.lastWorkspaceMode ?? 'studio') as keyof typeof MODE_LABELS](),
      keywords: [project.name, project.id, project.lastWorkspaceMode ?? ''],
      run: go(modePath(project.id, project.lastWorkspaceMode ?? undefined)),
    }));

    return [...nav, ...rows];
  }, [navigate, projects, close]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      [command.label, ...command.keywords].some((value) => value.toLowerCase().includes(needle))
    );
  }, [commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Global triggers. `/` is only a shortcut outside a text field, so typing a slash in
  // a prompt still types a slash.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === '/' && !isTyping(event.target)) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (filtered.length ? (index + 1) % filtered.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (filtered.length ? (index - 1 + filtered.length) % filtered.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      filtered[active]?.run();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-[rgba(23,21,15,0.16)] px-4 pt-[12vh] backdrop-blur-[1.5px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m['cmd.title']()}
        className="w-full max-w-[560px] overflow-hidden rounded-[16px] border border-ink/12 bg-[var(--beat-surface)] shadow-[var(--beat-shadow-lg)]"
      >
        <div className="flex items-center gap-2.5 border-b border-ink/[0.07] px-3.5">
          <Search className="size-4 shrink-0 text-[var(--beat-text-3)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={m['cmd.placeholder']()}
            aria-label={m['cmd.placeholder']()}
            className="h-12 w-full bg-transparent text-[13.5px] text-[var(--beat-text-1)] outline-none placeholder:text-[var(--beat-text-3)]"
          />
          <span className="shrink-0 text-[13.5px] text-[var(--beat-text-3)]">{m['cmd.hint']()}</span>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-[var(--beat-text-3)]">{m['cmd.empty']()}</p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                data-index={index}
                data-command={command.id}
                onPointerEnter={() => setActive(index)}
                onClick={command.run}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left transition',
                  index === active ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.04]'
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--beat-text-1)]">
                  {command.label}
                </span>
                {command.hint ? (
                  <span className="shrink-0 text-[13.5px] text-[var(--beat-text-3)]">{command.hint}</span>
                ) : null}
                {index === active ? (
                  <CornerDownLeft className="size-4 shrink-0 text-[var(--beat-text-3)]" />
                ) : (
                  <ArrowRight className="size-4 shrink-0 text-transparent" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-ink/[0.07] px-3.5 py-2 text-[13.5px] text-[var(--beat-text-3)]">
          <span className="inline-flex items-center gap-1">
            <Command className="size-2.5" />K
          </span>
          <span>{m['cmd.footer']()}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

import {
  FolderClock,
  PanelsTopLeft,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { BeatApiProductShell } from '@/components/marketing/beatapi-product-shell';
import { normalizeLocale } from '@/config/locale';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from '@/core/i18n/navigation';
import { buildLocalizedProjectDetailPath } from '@/core/projects/project-entry';
import { useWorkspaceProjects } from '@/core/workspace-hooks/use-workspace-projects';
import type { WorkspaceProjectCardItem } from '@/core/workspace-lib/app/workspace-client-api';
import { m } from '@/paraglide/messages.js';

function getHistoryCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    eyebrow: m['product.history.eyebrow']({}, { locale: messageLocale }),
    title: m['product.history.title']({}, { locale: messageLocale }),
    subtitle: m['product.history.subtitle']({}, { locale: messageLocale }),
    newProject: m['product.history.newProject']({}, { locale: messageLocale }),
    newStudio: m['product.history.newStudio']({}, { locale: messageLocale }),
    newCanvas: m['product.history.newCanvas']({}, { locale: messageLocale }),
    createTitle: m['product.history.createTitle'](
      {},
      { locale: messageLocale }
    ),
    createDescription: m['product.history.createDescription'](
      {},
      { locale: messageLocale }
    ),
    studioDescription: m['product.history.studioDescription'](
      {},
      { locale: messageLocale }
    ),
    canvasDescription: m['product.history.canvasDescription'](
      {},
      { locale: messageLocale }
    ),
    untitled: m['product.history.untitled']({}, { locale: messageLocale }),
    searchProjects: m['product.history.searchProjects']({}, { locale: messageLocale }),
    filterMode: m['product.history.filterMode']({}, { locale: messageLocale }),
    filterAll: m['product.history.filterAll']({}, { locale: messageLocale }),
    modeStudio: m['product.history.modeStudio']({}, { locale: messageLocale }),
    modeCanvas: m['product.history.modeCanvas']({}, { locale: messageLocale }),
    modeEditor: m['product.history.modeEditor']({}, { locale: messageLocale }),
    modeAssets: m['product.history.modeAssets']({}, { locale: messageLocale }),
    sortBy: m['product.history.sortBy']({}, { locale: messageLocale }),
    sortRecent: m['product.history.sortRecent']({}, { locale: messageLocale }),
    sortName: m['product.history.sortName']({}, { locale: messageLocale }),
    resultCount: (count: number) =>
      m['product.history.resultCount']({ count: String(count) }, { locale: messageLocale }),
    noMatch: m['product.history.noMatch']({}, { locale: messageLocale }),
    clearFilter: m['product.history.clearFilter']({}, { locale: messageLocale }),
    renameProject: m['product.history.renameProject']({}, { locale: messageLocale }),
    deleteConfirm: (projectName: string) =>
      m['product.history.deleteConfirm'](
        { projectName },
        { locale: messageLocale }
      ),
    deleteConfirmDescription: m['product.history.deleteConfirmDescription'](
      {},
      { locale: messageLocale }
    ),
    cancel: m['product.history.cancel']({}, { locale: messageLocale }),
    openProject: (projectName: string) =>
      m['product.history.openProject'](
        { projectName },
        { locale: messageLocale }
      ),
    deleteProject: m['product.history.deleteProject'](
      {},
      { locale: messageLocale }
    ),
    startFirst: m['product.history.startFirst'](
      {},
      { locale: messageLocale }
    ),
    emptyDescription: m['product.history.emptyDescription'](
      {},
      { locale: messageLocale }
    ),
  };
}

type HistoryCopy = ReturnType<typeof getHistoryCopy>;

function projectName(name: string, untitled: string) {
  const trimmed = name.trim();
  if (
    trimmed &&
    trimmed !== 'Untitled canvas' &&
    trimmed !== 'Untitled project'
  ) {
    return trimmed;
  }
  return untitled;
}

function CreateProjectDialog({
  open,
  onOpenChange,
  copy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: HistoryCopy;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-[26px] border border-ink/10 bg-[var(--beat-surface)] p-0 text-[var(--beat-text-1)] shadow-[0_34px_110px_rgba(0,0,0,0.62)] ring-0 sm:max-w-[620px] [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:text-ink/45 [&_[data-slot=dialog-close]]:hover:bg-ink/[0.07] [&_[data-slot=dialog-close]]:hover:text-white">
        <DialogHeader className="border-b border-ink/[0.08] px-6 pb-5 pt-6 text-left sm:px-7">
          <DialogTitle className="beat-product-display text-[24px] font-semibold tracking-[-0.035em] text-ink">
            {copy.createTitle}
          </DialogTitle>
          <DialogDescription className="w-full text-[13px] leading-6 text-ink/48 sm:whitespace-nowrap">
            {copy.createDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <Link
            href="/studio"
            className="group relative min-h-[190px] overflow-hidden rounded-[20px] border border-[#38bdf8]/35 bg-[radial-gradient(circle_at_82%_8%,rgba(56,189,248,0.22),transparent_42%),#171719] p-5 transition hover:-translate-y-0.5 hover:border-[#38bdf8]/65 hover:bg-[var(--beat-surface)]"
          >
            <span className="grid size-11 place-items-center rounded-[14px] bg-[#38bdf8] text-[#1d1d1f] shadow-[0_12px_30px_rgba(56,189,248,0.22)]">
              <PanelsTopLeft className="size-5" />
            </span>
            <h2 className="beat-product-display mt-8 text-[18px] font-semibold tracking-[-0.025em] text-ink">
              {copy.newStudio}
            </h2>
            <p className="mt-2 max-w-[220px] text-[12px] leading-5 text-ink/45">
              {copy.studioDescription}
            </p>
          </Link>

          <Link
            href="/canvas"
            className="group relative min-h-[190px] overflow-hidden rounded-[20px] border border-ink/[0.08] shadow-[var(--beat-shadow-sm)] bg-[radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.09),transparent_42%),#171719] p-5 transition hover:-translate-y-0.5 hover:border-ink/[0.22] hover:bg-[var(--beat-surface)]"
          >
            <span className="grid size-11 place-items-center rounded-[14px] border border-ink/[0.12] bg-[#202126] text-white">
              <Workflow className="size-5" />
            </span>
            <h2 className="beat-product-display mt-8 text-[18px] font-semibold tracking-[-0.025em] text-ink">
              {copy.newCanvas}
            </h2>
            <p className="mt-2 max-w-[220px] text-[12px] leading-5 text-ink/45">
              {copy.canvasDescription}
            </p>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspacePage({
  locale,
  projects,
}: {
  locale: string;
  projects: WorkspaceProjectCardItem[];
}) {
  const copy = getHistoryCopy(locale);
  const [createOpen, setCreateOpen] = useState(false);
  // Twenty-odd projects in a flat wall means finding last week film is an eye scan
  const [projectQuery, setProjectQuery] = useState('');
  const [projectMode, setProjectMode] = useState<'all' | 'studio' | 'canvas' | 'editor' | 'assets'>('all');
  const [projectSort, setProjectSort] = useState<'recent' | 'name'>('recent');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<WorkspaceProjectCardItem | null>(null);

  const { projects: liveProjects, deleteProjects, renameProject } = useWorkspaceProjects({
    locale,
    initialProjects: projects,
    enabled: true,
  });

  const visibleProjects = useMemo(() => {
    const needle = projectQuery.trim().toLowerCase();
    const filtered = liveProjects.filter((project) => {
      if (projectMode !== 'all' && project.lastWorkspaceMode !== projectMode) return false;
      if (!needle) return true;
      return projectName(project.name, copy.untitled).toLowerCase().includes(needle);
    });
    if (projectSort === 'name') {
      return [...filtered].sort((a, b) =>
        projectName(a.name, copy.untitled).localeCompare(projectName(b.name, copy.untitled), locale)
      );
    }
    return filtered;
  }, [liveProjects, projectQuery, projectMode, projectSort, copy.untitled, locale]);

  const commitRename = async () => {
    if (!renaming) return;
    const next = renaming.name.trim();
    const target = { ...renaming };
    setRenaming(null);
    if (!next) return;
    await renameProject(target.id, next);
  };

  async function removeProject(project: WorkspaceProjectCardItem) {
    setDeleteTarget(project);
  }

  async function confirmRemoveProject() {
    if (!deleteTarget) return;
    await deleteProjects([deleteTarget.id]);
    setDeleteTarget(null);
  }

  return (
    <BeatApiProductShell active="projects" locale={locale}>
      <main className="mx-auto w-full max-w-[1280px] px-5 pb-10 pt-14 sm:px-6">
        <section className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-[var(--beat-accent)] sm:text-[11px]">
              {copy.eyebrow}
            </p>
            <h1 className="beat-product-display beat-product-page-title mt-4 max-w-3xl text-balance text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em] text-[var(--beat-text-1)]">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-[14px] font-normal leading-6 text-[var(--beat-text-2)] sm:text-[15px]">
              {copy.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 self-start rounded-[var(--beat-radius-sm)] bg-[var(--beat-accent)] px-5 text-[13px] font-semibold text-[var(--beat-accent-ink)] shadow-[0_8px_28px_rgba(56,189,248,0.22)] transition hover:bg-[#4cc2ff] lg:self-auto"
          >
            <Plus className="size-4" />
            {copy.newProject}
          </button>
        </section>

        <section className="mt-12">
          {liveProjects.length > 0 ? (
            <div className="mb-6 flex flex-wrap items-center gap-2" data-project-toolbar="true">
              <input
                type="search"
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder={copy.searchProjects}
                aria-label={copy.searchProjects}
                data-project-search="true"
                className="h-9 min-w-[180px] flex-1 rounded-[10px] border border-ink/[0.1] bg-[var(--beat-surface)] px-3 text-[12.5px] text-[var(--beat-text-1)] outline-none placeholder:text-[var(--beat-text-3)]"
              />
              <select
                value={projectMode}
                onChange={(event) => setProjectMode(event.target.value as typeof projectMode)}
                aria-label={copy.filterMode}
                data-project-filter="true"
                className="h-9 rounded-[10px] border border-ink/[0.1] bg-[var(--beat-surface)] px-2 text-[12px] text-[var(--beat-text-2)] outline-none"
              >
                <option value="all">{copy.filterAll}</option>
                <option value="studio">{copy.modeStudio}</option>
                <option value="canvas">{copy.modeCanvas}</option>
                <option value="editor">{copy.modeEditor}</option>
                <option value="assets">{copy.modeAssets}</option>
              </select>
              <select
                value={projectSort}
                onChange={(event) => setProjectSort(event.target.value as typeof projectSort)}
                aria-label={copy.sortBy}
                data-project-sort="true"
                className="h-9 rounded-[10px] border border-ink/[0.1] bg-[var(--beat-surface)] px-2 text-[12px] text-[var(--beat-text-2)] outline-none"
              >
                <option value="recent">{copy.sortRecent}</option>
                <option value="name">{copy.sortName}</option>
              </select>
              <span className="text-[11px] tabular-nums text-[var(--beat-text-3)]" data-project-count="true">
                {copy.resultCount(visibleProjects.length)}
              </span>
            </div>
          ) : null}

          {liveProjects.length === 0 ? (
            <div className="flex min-h-[330px] flex-col items-center justify-center rounded-[var(--beat-radius)] border border-dashed border-ink/[0.1] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.6),transparent_70%)]">
              <span className="grid size-14 place-items-center rounded-[var(--beat-radius-sm)] border border-ink/[0.1] bg-[var(--beat-surface)] text-[var(--beat-text-3)]">
                <FolderClock className="size-6" />
              </span>
              <h2 className="beat-product-display mt-5 text-[21px] font-semibold tracking-[-0.03em]">
                {copy.startFirst}
              </h2>
              <p className="mt-2 max-w-md text-[13px] font-normal leading-6 text-[var(--beat-text-2)]">
                {copy.emptyDescription}
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-[var(--beat-radius-sm)] bg-[var(--beat-accent)] px-4 text-[13px] font-medium text-[var(--beat-accent-ink)]"
              >
                <Plus className="size-4" />
                {copy.newProject}
              </button>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[var(--beat-radius)] border border-dashed border-ink/[0.1]">
              <p className="text-[13px] text-[var(--beat-text-2)]" data-project-empty="true">
                {copy.noMatch}
              </p>
              <button
                type="button"
                onClick={() => {
                  setProjectQuery('');
                  setProjectMode('all');
                }}
                className="mt-3 text-[12px] text-[var(--beat-accent)] underline-offset-4 hover:underline"
              >
                {copy.clearFilter}
              </button>
            </div>
          ) : (
            <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleProjects.map((project) => {
                const name = projectName(project.name, copy.untitled);
                return (
                  <article key={project.id} className="group relative min-w-0" data-project-card="true">
                    {renaming?.id === project.id ? (
                      <div className="flex aspect-[16/10] items-center justify-center rounded-[var(--beat-radius)] border border-[var(--beat-accent)]/45 bg-[var(--beat-surface)] p-3">
                        <input
                          autoFocus
                          value={renaming.name}
                          onChange={(event) => setRenaming({ id: project.id, name: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void commitRename();
                            if (event.key === 'Escape') setRenaming(null);
                          }}
                          onBlur={() => void commitRename()}
                          aria-label={copy.renameProject}
                          data-rename-input="true"
                          className="w-full rounded-[8px] border border-ink/[0.14] bg-transparent px-2 py-1 text-[13px] text-[var(--beat-text-1)] outline-none"
                        />
                      </div>
                    ) : (
                    <Link
                      href={buildLocalizedProjectDetailPath({
                        locale,
                        projectId: project.id,
                        mode: project.lastWorkspaceMode,
                      })}
                      aria-label={copy.openProject(name)}
                      className="block"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden rounded-[var(--beat-radius)] border border-ink/[0.08] bg-[radial-gradient(circle_at_72%_18%,rgba(56,189,248,0.10),transparent_40%),#111113] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition duration-300 group-hover:-translate-y-0.5 group-hover:border-ink/[0.18]">
                        {project.coverImageUrl ? (
                          <img
                            src={project.coverImageUrl}
                            alt=""
                            className="size-full object-cover transition duration-500 group-hover:scale-[1.025]"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-ink/14">
                            <FolderClock className="size-11" strokeWidth={1.15} />
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" />
                      </div>
                      <h2 className="beat-product-display mt-3 truncate px-1 text-[15px] font-semibold tracking-[-0.02em] text-[var(--beat-text-1)]">
                        {name}
                      </h2>
                    </Link>
                    )}

                    {renaming?.id === project.id ? null : (
                      <button
                        type="button"
                        onClick={() => setRenaming({ id: project.id, name: name })}
                        aria-label={copy.renameProject}
                        data-rename-project="true"
                        className="absolute right-12 top-3 grid size-8 place-items-center rounded-full border border-ink/[0.1] bg-[var(--beat-surface)]/90 text-[var(--beat-text-3)] opacity-0 transition hover:text-ink group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeProject(project)}
                      aria-label={copy.deleteProject}
                      className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-ink/10 bg-black/60 text-ink/60 opacity-0 backdrop-blur transition hover:bg-red-500 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        copy={copy}
      />

      <ConfirmDialog
        variant="beat"
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={
          deleteTarget
            ? copy.deleteConfirm(
                projectName(deleteTarget.name, copy.untitled)
              )
            : ''
        }
        description={copy.deleteConfirmDescription}
        confirmLabel={copy.deleteProject}
        cancelLabel={copy.cancel}
        onConfirm={confirmRemoveProject}
      />
    </BeatApiProductShell>
  );
}

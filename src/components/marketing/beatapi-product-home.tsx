import {
  ArrowRight,
  ArrowUp,
  FolderClock,
  PanelsTopLeft,
  Workflow,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Link } from '@/core/i18n/navigation';
import { normalizeLocale } from '@/config/locale';
import { m } from '@/paraglide/messages.js';
import { HeroSlogan } from './hero-slogan';
import { BeatApiProductShell } from './beatapi-product-shell';

function getCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    eyebrow: m['product.home.eyebrow']({}, { locale: messageLocale }),
    titleLine1: m['product.home.titleLine1']({}, { locale: messageLocale }),
    titleLine2: m['product.home.titleLine2']({}, { locale: messageLocale }),
    prompt: m['product.home.prompt']({}, { locale: messageLocale }),
    sectionTitle: m['product.home.sectionTitle']({}, { locale: messageLocale }),
    projects: m['product.home.viewProjects']({}, { locale: messageLocale }),
    studioDescription: m['product.home.studioDescription'](
      {},
      { locale: messageLocale }
    ),
    canvasDescription: m['product.home.canvasDescription'](
      {},
      { locale: messageLocale }
    ),
    projectsTitle: m['product.home.projectsTitle'](
      {},
      { locale: messageLocale }
    ),
    projectsDescription: m['product.home.projectsDescription'](
      {},
      { locale: messageLocale }
    ),
    open: m['product.home.openWorkspace']({}, { locale: messageLocale }),
    create: m['product.shell.create']({}, { locale: messageLocale }),
  };
}

type HomeCopy = ReturnType<typeof getCopy>;

function WorkspaceCard({
  title,
  index,
  description,
  href,
  icon,
  openLabel,
}: {
  title: string;
  index: string;
  description: string;
  href: string;
  icon: ReactNode;
  openLabel: string;
}) {
  return (
    <Link href={href} className="group block h-full">
      <article className="relative flex h-full min-h-[212px] flex-col overflow-hidden rounded-[var(--beat-radius)] border border-ink/[0.07] bg-ink/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition duration-300 hover:-translate-y-0.5 hover:border-ink/[0.16] hover:bg-ink/[0.045]">
        <div className="flex items-start justify-between">
          <span className="grid size-10 place-items-center rounded-[var(--beat-radius-sm)] border border-ink/[0.06] bg-[var(--beat-surface-2)] text-[var(--beat-accent)] transition-shadow duration-300 group-hover:shadow-[0_0_28px_rgba(56,189,248,0.2)]">
            {icon}
          </span>
          <span className="beat-product-display text-[11px] font-semibold tracking-[0.14em] text-ink/25">
            {index}
          </span>
        </div>
        <h3 className="beat-product-display mt-6 text-[17px] font-semibold tracking-[-0.02em] text-[var(--beat-text-1)]">
          {title}
        </h3>
        <p className="mt-2 truncate whitespace-nowrap text-[13px] leading-[1.65] text-[var(--beat-text-2)]">
          {description}
        </p>
        <span className="mt-auto inline-flex items-center gap-2 pt-6 text-[12.5px] font-medium text-ink/65 transition-colors group-hover:text-ink">
          {openLabel}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
        </span>
      </article>
    </Link>
  );
}

function PromptComposer({ copy }: { copy: HomeCopy }) {
  const [prompt, setPrompt] = useState('');

  return (
    <form
      action="/studio"
      method="get"
      className="mx-auto mt-10 flex min-h-[160px] w-full max-w-[720px] flex-col rounded-[var(--beat-radius)] border border-ink/[0.13] bg-[image:var(--beat-card)] p-5 text-left shadow-[var(--beat-card-shadow)] sm:p-6"
    >
      <textarea
        name="prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={copy.prompt}
        aria-label={copy.prompt}
        className="min-h-16 w-full resize-none border-0 bg-transparent text-[15px] leading-6 text-ink outline-none placeholder:text-[var(--beat-text-3)] sm:text-base"
      />
      <div className="mt-auto flex items-end justify-end">
        <button
          type="submit"
          aria-label={copy.create}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--beat-accent)] text-[var(--beat-accent-ink)] shadow-[var(--beat-accent-shadow)] transition hover:scale-[1.04] hover:bg-[var(--beat-accent-hover)]"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  );
}

export function BeatApiProductHome({ locale }: { locale: string }) {
  const copy = getCopy(locale);
  const titleLines = [copy.titleLine1, copy.titleLine2];

  return (
    <BeatApiProductShell active="home" locale={locale}>
      <main className="mx-auto w-full max-w-[1280px] px-5 sm:px-6">
        <section className="beat-product-hero relative overflow-hidden pb-14 pt-[64px] text-center sm:pt-[84px] lg:pb-[72px]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 [background-image:var(--beat-hero-glow)]"
          />
          <div className="relative">
          <p className="beat-product-display inline-flex items-center gap-2.5 text-[10px] font-semibold tracking-[0.18em] text-[var(--beat-accent)] sm:text-[11px]">
            <span className="size-1.5 rounded-full bg-[var(--beat-accent)]" />
            {copy.eyebrow}
          </p>
          <HeroSlogan locale={locale} />
          <PromptComposer copy={copy} />
          </div>
        </section>

        <section className="pb-14">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="beat-product-display text-xl font-semibold tracking-[-0.03em] text-[var(--beat-text-1)] sm:text-[22px]">
              {copy.sectionTitle}
            </h2>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--beat-text-2)] transition hover:text-ink"
            >
              {copy.projects}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <WorkspaceCard
              title="Studio"
              index="01"
              description={copy.studioDescription}
              href="/studio"
              icon={<PanelsTopLeft className="size-5" />}
              openLabel={copy.open}
            />
            <WorkspaceCard
              title="Canvas"
              index="02"
              description={copy.canvasDescription}
              href="/canvas"
              icon={<Workflow className="size-5" />}
              openLabel={copy.open}
            />
            <WorkspaceCard
              title={copy.projectsTitle}
              index="03"
              description={copy.projectsDescription}
              href="/projects"
              icon={<FolderClock className="size-5" />}
              openLabel={copy.open}
            />
          </div>
        </section>
      </main>
    </BeatApiProductShell>
  );
}

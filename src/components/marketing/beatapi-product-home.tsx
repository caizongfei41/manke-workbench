import {
  ArrowRight,
  ArrowUp,
  Clapperboard,
  FolderClock,
  Layers,
  Sparkles,
  Wand2,
  Workflow,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Link } from '@/core/i18n/navigation';
import { normalizeLocale } from '@/config/locale';
import { m } from '@/paraglide/messages.js';
import { HeroSlogan } from './hero-slogan';
import { HomeShowcase } from './home-showcase';
import { ShowcaseManager } from './showcase-manager';
import { BeatApiProductShell } from './beatapi-product-shell';

function getCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    eyebrow: m['product.home.eyebrow']({}, { locale: messageLocale }),
    prompt: m['product.home.prompt']({}, { locale: messageLocale }),
    create: m['product.shell.create']({}, { locale: messageLocale }),
    projects: m['product.home.viewProjects']({}, { locale: messageLocale }),
    studioDescription: m['product.home.studioDescription']({}, { locale: messageLocale }),
    canvasDescription: m['product.home.canvasDescription']({}, { locale: messageLocale }),
    projectsTitle: m['product.home.projectsTitle']({}, { locale: messageLocale }),
    projectsDescription: m['product.home.projectsDescription']({}, { locale: messageLocale }),
    open: m['product.home.openWorkspace']({}, { locale: messageLocale }),
    composerHint: m['home.composer.hint']({}, { locale: messageLocale }),
    workspacesTitle: m['home.workspaces.title']({}, { locale: messageLocale }),
    workspacesSubtitle: m['home.workspaces.subtitle']({}, { locale: messageLocale }),
    workspaceStudioTitle: m['home.workspaces.studioTitle']({}, { locale: messageLocale }),
    workspaceStudioOutput: m['home.workspaces.studioOutput']({}, { locale: messageLocale }),
    workspaceStandardTitle: m['home.workspaces.standardTitle']({}, { locale: messageLocale }),
    workspaceStandardBody: m['home.workspaces.standardBody']({}, { locale: messageLocale }),
    workspaceStandardOutput: m['home.workspaces.standardOutput']({}, { locale: messageLocale }),
    workspaceCanvasTitle: m['home.workspaces.canvasTitle']({}, { locale: messageLocale }),
    workspaceCanvasOutput: m['home.workspaces.canvasOutput']({}, { locale: messageLocale }),
    workspaceProjectsOutput: m['home.workspaces.projectsOutput']({}, { locale: messageLocale }),
    capabilitiesTitle: m['home.capabilities.title']({}, { locale: messageLocale }),
    capabilitiesSubtitle: m['home.capabilities.subtitle']({}, { locale: messageLocale }),
    cap1Title: m['home.capabilities.directorTitle']({}, { locale: messageLocale }),
    cap1Body: m['home.capabilities.directorBody']({}, { locale: messageLocale }),
    cap2Title: m['home.capabilities.batchTitle']({}, { locale: messageLocale }),
    cap2Body: m['home.capabilities.batchBody']({}, { locale: messageLocale }),
    cap3Title: m['home.capabilities.localTitle']({}, { locale: messageLocale }),
    cap3Body: m['home.capabilities.localBody']({}, { locale: messageLocale }),
    cap4Title: m['home.capabilities.editTitle']({}, { locale: messageLocale }),
    cap4Body: m['home.capabilities.editBody']({}, { locale: messageLocale }),
    ctaTitle: m['home.cta.title']({}, { locale: messageLocale }),
    ctaBody: m['home.cta.body']({}, { locale: messageLocale }),
    ctaPrimary: m['home.cta.primary']({}, { locale: messageLocale }),
    ctaSecondary: m['home.cta.secondary']({}, { locale: messageLocale }),
  };
}

type HomeCopy = ReturnType<typeof getCopy>;

function PromptComposer({ copy }: { copy: HomeCopy }) {
  const [prompt, setPrompt] = useState('');

  return (
    <form
      action="/studio"
      method="get"
      className="beat-glass mx-auto mt-8 flex min-h-[150px] w-full max-w-[860px] flex-col rounded-[24px] p-5 text-left sm:p-6"
      data-composer="true"
    >
      <textarea
        name="prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={copy.prompt}
        aria-label={copy.prompt}
        className="min-h-16 w-full resize-none border-0 bg-transparent text-[16px] leading-7 text-[var(--beat-text-1)] outline-none placeholder:text-[var(--beat-text-3)] sm:text-base"
      />
      <div className="mt-auto flex items-center justify-between gap-3 pt-3">
        <span className="text-[15px] text-[var(--beat-text-3)]">{copy.composerHint}</span>
        <button
          type="submit"
          aria-label={copy.create}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--beat-accent)] text-[var(--beat-accent-ink)] shadow-[var(--beat-accent-shadow)] transition hover:scale-[1.05] hover:bg-[var(--beat-accent-hover)]"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  );
}

function Capability({
  title,
  body,
  icon,
  tint,
}: {
  title: string;
  body: string;
  icon: ReactNode;
  tint: string;
}) {
  return (
    <article className="beat-glass group relative flex min-h-[196px] flex-col overflow-hidden rounded-[22px] p-5 transition duration-300 hover:-translate-y-1">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full opacity-55 blur-2xl transition-opacity duration-500 group-hover:opacity-90"
        style={{ background: tint }}
      />
      <span className="relative grid size-11 place-items-center rounded-[14px] border border-white/12 bg-[var(--beat-glass-sheen)] text-[var(--beat-text-1)] backdrop-blur-md">
        {icon}
      </span>
      <h3 className="beat-product-display relative mt-5 text-[16.5px] font-semibold tracking-[-0.02em] text-[var(--beat-text-1)]">
        {title}
      </h3>
      <p className="relative mt-2 text-[15px] leading-[1.75] text-[var(--beat-text-2)]">{body}</p>
    </article>
  );
}

export function BeatApiProductHome({ locale }: { locale: string }) {
  const copy = getCopy(locale);

  return (
    <BeatApiProductShell active="home" locale={locale}>
      <div className="relative isolate overflow-hidden">
        {/* Ambient light: two radial washes plus one blurred ring give the glass its depth */}
        <div aria-hidden="true" className="beat-aurora pointer-events-none absolute inset-x-0 top-0 h-[720px]" />
        <div
          aria-hidden="true"
          className="beat-ring pointer-events-none absolute left-1/2 top-[-160px] h-[300px] w-[720px] -translate-x-1/2 opacity-40"
        />

        <main className="relative mx-auto w-full max-w-[2040px] px-5 sm:px-6">
          <section className="relative pb-2 pt-[56px] text-center sm:pt-[72px]">
            <p className="beat-glass inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[15px] font-semibold tracking-[0.18em] text-[var(--beat-text-2)] sm:text-[15px]">
              <span className="size-1.5 rounded-full bg-[var(--beat-accent)]" />
              {copy.eyebrow}
            </p>
            <HeroSlogan locale={locale} />
            <PromptComposer copy={copy} />
          </section>

          <HomeShowcase locale={locale} />

          <ShowcaseManager locale={locale} />

          {/* Capabilities */}
          <section className="mt-20">
            <div className="mb-6 max-w-2xl">
              <h2 className="beat-product-display text-[20px] font-semibold tracking-[-0.03em] text-[var(--beat-text-1)] sm:text-[24px]">
                {copy.capabilitiesTitle}
              </h2>
              <p className="mt-2 text-[15px] leading-6 text-[var(--beat-text-2)]">
                {copy.capabilitiesSubtitle}
              </p>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <Capability
                title={copy.cap1Title}
                body={copy.cap1Body}
                icon={<Clapperboard className="size-5" />}
                tint="radial-gradient(circle, rgba(56,189,248,0.55), transparent 70%)"
              />
              <Capability
                title={copy.cap2Title}
                body={copy.cap2Body}
                icon={<Layers className="size-5" />}
                tint="radial-gradient(circle, rgba(168,85,247,0.5), transparent 70%)"
              />
              <Capability
                title={copy.cap3Title}
                body={copy.cap3Body}
                icon={<Wand2 className="size-5" />}
                tint="radial-gradient(circle, rgba(251,146,60,0.45), transparent 70%)"
              />
              <Capability
                title={copy.cap4Title}
                body={copy.cap4Body}
                icon={<Sparkles className="size-5" />}
                tint="radial-gradient(circle, rgba(34,211,238,0.45), transparent 70%)"
              />
            </div>
          </section>

          {/* Workspace entries */}
          <section className="mt-20">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="beat-product-display text-[20px] font-semibold tracking-[-0.03em] text-[var(--beat-text-1)] sm:text-[24px]">
                  {copy.workspacesTitle}
                </h2>
                <p className="mt-2 max-w-xl text-[15px] leading-6 text-[var(--beat-text-2)]">
                  {copy.workspacesSubtitle}
                </p>
              </div>
              <Link
                href="/projects"
                className="inline-flex items-center gap-1.5 text-[15px] font-medium text-[var(--beat-text-2)] transition hover:text-ink"
              >
                {copy.projects}
                <ArrowRight className="size-3.5" />
              </Link>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  title: copy.workspaceStudioTitle,
                  href: '/studio',
                  body: copy.studioDescription,
                  output: copy.workspaceStudioOutput,
                  icon: <Wand2 className="size-5" />,
                  tint: 'radial-gradient(circle, rgba(56,189,248,0.5), transparent 70%)',
                },
                {
                  title: copy.workspaceCanvasTitle,
                  href: '/canvas',
                  body: copy.canvasDescription,
                  output: copy.workspaceCanvasOutput,
                  icon: <Workflow className="size-5" />,
                  tint: 'radial-gradient(circle, rgba(168,85,247,0.45), transparent 70%)',
                },
                {
                  title: copy.workspaceStandardTitle,
                  href: '/standard',
                  body: copy.workspaceStandardBody,
                  output: copy.workspaceStandardOutput,
                  icon: <Layers className="size-5" />,
                  tint: 'radial-gradient(circle, rgba(125,211,252,0.45), transparent 70%)',
                },
                {
                  title: copy.projectsTitle,
                  href: '/projects',
                  body: copy.projectsDescription,
                  output: copy.workspaceProjectsOutput,
                  icon: <FolderClock className="size-5" />,
                  tint: 'radial-gradient(circle, rgba(251,146,60,0.4), transparent 70%)',
                },
              ].map((entry, index) => (
                <Link key={entry.href} href={entry.href} className="group block">
                  <article className="beat-glass relative flex h-full min-h-[224px] flex-col overflow-hidden rounded-[22px] p-5 transition duration-300 hover:-translate-y-1">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full opacity-50 blur-2xl transition-opacity duration-500 group-hover:opacity-90"
                      style={{ background: entry.tint }}
                    />
                    <div className="relative flex items-start justify-between">
                      <span className="grid size-10 place-items-center rounded-[13px] border border-white/12 bg-[var(--beat-glass-sheen)] text-[var(--beat-text-1)] backdrop-blur-md">
                        {entry.icon}
                      </span>
                      <span className="beat-product-display text-[15px] font-semibold tracking-[0.14em] text-[var(--beat-text-3)]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <h3 className="beat-product-display relative mt-5 text-[16px] font-semibold tracking-[-0.02em] text-[var(--beat-text-1)]">
                      {entry.title}
                    </h3>
                    <p className="relative mt-2 text-[15px] leading-[1.75] text-[var(--beat-text-2)]">
                      {entry.body}
                    </p>
                    <p className="relative mt-3 inline-flex items-center gap-1.5 text-[15px] text-[var(--beat-text-3)]">
                      <span className="size-1 rounded-full bg-[var(--beat-accent)]" />
                      {entry.output}
                    </p>
                    <span className="relative mt-auto inline-flex items-center gap-1.5 pt-5 text-[15px] font-medium text-[var(--beat-text-1)]">
                      {copy.open}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </article>
                </Link>
              ))}
            </div>
          </section>

          {/* Closing call to action */}
          <section className="mt-20">
            <div className="beat-glass relative overflow-hidden rounded-[26px] px-6 py-10 text-center sm:px-10 sm:py-12">
              <div
                aria-hidden="true"
                className="beat-ring pointer-events-none absolute left-1/2 top-1/2 h-[220px] w-[520px] -translate-x-1/2 -translate-y-1/2 opacity-30"
              />
              <h2 className="beat-product-display relative mx-auto max-w-xl text-[24px] font-semibold leading-tight tracking-[-0.035em] text-[var(--beat-text-1)] sm:text-[30px]">
                {copy.ctaTitle}
              </h2>
              <p className="relative mx-auto mt-3 max-w-lg text-[15px] leading-6 text-[var(--beat-text-2)]">
                {copy.ctaBody}
              </p>
              <div className="relative mt-7 flex flex-wrap items-center justify-center gap-2.5">
                <Link
                  href="/studio"
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--beat-accent)] px-6 text-[15px] font-medium text-[var(--beat-accent-ink)] shadow-[var(--beat-accent-shadow)] transition hover:scale-[1.02] hover:bg-[var(--beat-accent-hover)]"
                >
                  {copy.ctaPrimary}
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/projects"
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--beat-glass-border)] bg-[var(--beat-glass-bg)] px-6 text-[15px] font-medium text-[var(--beat-text-1)] backdrop-blur-xl transition hover:border-ink/25"
                >
                  {copy.ctaSecondary}
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </BeatApiProductShell>
  );
}

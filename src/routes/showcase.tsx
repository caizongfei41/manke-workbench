import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { ShowcaseManager } from '@/components/marketing/showcase-manager';
import { m } from '@/paraglide/messages.js';

/**
 * Front-page curation, on its own page.
 *
 * This used to sit under the carousel on the home page, which meant every visitor
 * scrolled past a grid of editing controls. Managing the cover is a rare, deliberate
 * act — it belongs behind a link, not in the first screenful.
 */
export const Route = createFileRoute('/showcase')({
  component: ShowcaseRouteComponent,
});

function ShowcaseRouteComponent() {
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
          <h1 className="text-[15px] font-semibold">{m['showcase.page.title']()}</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[980px] flex-1 px-4 py-6 lg:px-5">
        <ShowcaseManager />
      </main>
    </div>
  );
}

import { createFileRoute } from '@tanstack/react-router';

import { TrashPage } from '@/components/trash/trash-page';
import { getLocale } from '@/core/workspace-lib/shims/next-intl-server';

/**
 * Trash page.
 *
 * Deleting a project or asset does not erase anything: files move under
 * trash/ and rows get a soft-delete stamp, so the next 7 days are recoverable.
 * Expired entries are swept lazily by /api/app/trash when it is read.
 */
export const Route = createFileRoute('/trash')({
  loader: () => ({ locale: getLocale() }),
  component: TrashRouteComponent,
});

function TrashRouteComponent() {
  const { locale } = Route.useLoaderData();
  return <TrashPage locale={locale} />;
}

import { createFileRoute } from '@tanstack/react-router';

import { AssetLibraryPage } from '@/components/assets/asset-library-page';
import { getLocale } from '@/core/workspace-lib/shims/next-intl-server';

/**
 * `/assets` used to redirect to the project list, because there was no such thing as an
 * asset that was not inside a project. There is now: this is the library across all of
 * them.
 */
export const Route = createFileRoute('/assets/')({
  loader: () => ({ locale: getLocale() }),
  component: AssetLibraryRoute,
});

function AssetLibraryRoute() {
  const { locale } = Route.useLoaderData();
  return <AssetLibraryPage locale={locale} />;
}

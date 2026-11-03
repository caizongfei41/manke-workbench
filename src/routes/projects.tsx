import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { WorkspacePage } from '@/components/home/workspace-page';
import {
  buildLocalizedCreateProjectPath,
  parseProjectEntryIntent,
} from '@/core/projects/project-entry';
import { loadSerializedProjectsFn } from '@/core/projects/server-functions';
import { getLocale } from '@/core/workspace-lib/shims/next-intl-server';

export const Route = createFileRoute('/projects')({
  validateSearch: (search: Record<string, unknown>) => ({
    target: (search.target as string) || undefined,
    model: (search.model as string) || undefined,
    prompt: (search.prompt as string) || undefined,
  }),
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => {
    const locale = getLocale();
    const { target, model, prompt } = parseProjectEntryIntent(deps.search);

    if (target || model || prompt) {
      throw redirect({
        to: buildLocalizedCreateProjectPath({
          locale,
          target,
          model,
          prompt,
          mode: 'canvas',
        }) as never,
      });
    }

    const projects = await loadSerializedProjectsFn({ data: {} });

    return {
      locale,
      projects,
    };
  },
  component: ProjectsRouteComponent,
});

/**
 * Project list page.
 *
 * The loader result is only the initial value: TanStack Router caches it and
 * does not re-run it when navigating back from another page. After restoring a
 * project from the trash, coming back here showed the pre-restore list, so the
 * restore looked like it had not worked.
 *
 * Re-fetch on mount and replace the cached snapshot. The first paint still has
 * data, so there is no flash of an empty list.
 */
function ProjectsRouteComponent() {
  const { locale, projects: initialProjects } = Route.useLoaderData();
  const [projects, setProjects] = useState(initialProjects);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await loadSerializedProjectsFn({ data: {} });
        if (!cancelled) setProjects(fresh);
      } catch {
        /* fetch failed: keep the initial value rather than a blank list */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <WorkspacePage locale={locale} projects={projects} />;
}

import { createFileRoute, redirect } from '@tanstack/react-router';

import { loadSerializedProjectsFn } from '@/core/projects/server-functions';
import { getLocale } from '@/core/workspace-lib/shims/next-intl-server';

/**
 * `/standard` on its own: open the standard canvas of the most recent project.
 *
 * The board belongs to a project, so there is nothing to show without one — but landing
 * on a dead end after the front page promised a canvas is worse than picking for you.
 */
export const Route = createFileRoute('/standard/')({
  loader: async () => {
    const locale = getLocale();
    const projects = await loadSerializedProjectsFn({ data: {} });
    const newest = [...(projects ?? [])].sort(
      (a, b) => new Date(b.activityAt ?? 0).getTime() - new Date(a.activityAt ?? 0).getTime()
    )[0];

    if (!newest) {
      throw redirect({ to: '/projects' } as never);
    }
    throw redirect({ to: '/standard/$projectId', params: { projectId: newest.id } } as never);
  },
  component: () => null,
});

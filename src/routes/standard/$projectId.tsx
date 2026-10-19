import { createFileRoute } from '@tanstack/react-router';

import { StandardCanvasRoute } from '@/components/standard/standard-canvas-route';
import { loadWorkspaceProjectRoute } from '@/core/projects/workspace-project-route-loader';

/**
 * Dedicated entry for the standard canvas.
 *
 * It renders full screen on purpose: the reference board carries its own chrome (capsule
 * bar, rail, composer), so wrapping it in the product shell would double the navigation.
 */
export const Route = createFileRoute('/standard/$projectId')({
  ssr: 'data-only',
  validateSearch: (search: Record<string, unknown>) => ({
    target: (search.target as string) || undefined,
    model: (search.model as string) || undefined,
    prompt: (search.prompt as string) || undefined,
    preview: (search.preview as string) || undefined,
    focus: (search.focus as string) || undefined,
  }),
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ params, deps }) =>
    loadWorkspaceProjectRoute({
      projectId: params.projectId,
      search: deps.search,
      workspaceMode: 'canvas',
    }),
  component: StandardProjectRouteComponent,
});

function StandardProjectRouteComponent() {
  const data = Route.useLoaderData();
  return (
    <StandardCanvasRoute
      key={data.project.id}
      projectId={data.project.id}
      projectName={data.project.name}
      snapshot={data.snapshot ?? null}
      snapshotVersion={data.snapshotVersion ?? null}
    />
  );
}

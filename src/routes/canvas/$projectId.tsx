import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceProjectRoutePage } from '@/components/app/workspace-project-route-page';
import { loadWorkspaceProjectRoute } from '@/core/projects/workspace-project-route-loader';

export const Route = createFileRoute('/canvas/$projectId')({
  ssr: 'data-only',
  validateSearch: (search: Record<string, unknown>) => ({
    target: (search.target as string) || undefined,
    model: (search.model as string) || undefined,
    prompt: (search.prompt as string) || undefined,
    preview: (search.preview as string) || undefined,
    focus: (search.focus as string) || undefined,
    // Drama mode reuses /canvas/:id and is distinguished by ?kind=drama.
    // Without this the tab looked dead: the param was dropped here, so the page
    // always landed on the plain canvas branch.
    kind: (search.kind as string) || undefined,
  }),
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ params, deps }) =>
    loadWorkspaceProjectRoute({
      projectId: params.projectId,
      search: deps.search,
      workspaceMode: 'canvas',
    }),
  component: CanvasProjectRouteComponent,
});

function CanvasProjectRouteComponent() {
  return <WorkspaceProjectRoutePage data={Route.useLoaderData()} />;
}

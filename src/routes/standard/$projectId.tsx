import { createFileRoute } from '@tanstack/react-router';

import { ProductPageShell } from '@/components/app/product-page-shell';
import { StandardCanvasRoute } from '@/components/standard/standard-canvas-route';
import { loadWorkspaceProjectRoute } from '@/core/projects/workspace-project-route-loader';

/**
 * The standard canvas, inside the workbench's own shell.
 *
 * It used to render full screen with its own chrome copied from a reference product, which
 * made it look like a different application: small type in a floating bar, a dark surface,
 * and two empty gutters either side. It is a workspace like any other now, so it gets the
 * same header, the same tabs and the same tokens.
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
    <ProductPageShell
      workspaceName={data.project.name}
      projectId={data.project.id}
      workspaceMode="canvas"
    >
      <StandardCanvasRoute
        key={data.project.id}
        projectId={data.project.id}
        projectName={data.project.name}
        snapshot={data.snapshot ?? null}
        snapshotVersion={data.snapshotVersion ?? null}
      />
    </ProductPageShell>
  );
}

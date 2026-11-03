import { lazy, Suspense } from 'react';

import { ProductPageShell } from '@/components/app/product-page-shell';

// Every project route used to import all five workspaces, so opening one downloaded the
// code for all of them (≈483 KB). Load the one that is actually being opened instead.
const ProjectAssetsWorkspace = lazy(() =>
  import('@/components/app/project-assets-workspace').then((m) => ({
    default: m.ProjectAssetsWorkspace,
  }))
);
const BeatStudioWorkspace = lazy(() =>
  import('@/components/studio/beat-studio-workspace').then((m) => ({
    default: m.BeatStudioWorkspace,
  }))
);
const BeatCanvasShell = lazy(() =>
  import('@/components/beatcanvas/beatcanvas-shell').then((m) => ({ default: m.BeatCanvasShell }))
);
const DramaCanvasRoute = lazy(() =>
  import('@/components/drama/drama-canvas-route').then((m) => ({ default: m.DramaCanvasRoute }))
);
const VideoEditorWorkspace = lazy(() =>
  import('@/components/editor/video-editor-workspace').then((m) => ({
    default: m.VideoEditorWorkspace,
  }))
);
import type { loadWorkspaceProjectRoute } from '@/core/projects/workspace-project-route-loader';

type WorkspaceProjectRouteData = Awaited<
  ReturnType<typeof loadWorkspaceProjectRoute>
>;

export function WorkspaceProjectRoutePage({
  data,
}: {
  data: WorkspaceProjectRouteData;
}) {
  // Drama mode reuses /canvas/:id and is entered through ?kind=drama.
  //
  // The decision must come from the URL, not from snapshot.canvasKind:
  //   · AI Drama tab adds ?kind=drama   -> drama canvas
  //   · Canvas tab drops it             -> plain canvas
  // canvasKind only records what the project was created as, so trusting it
  // meant a drama project could never switch back: the Canvas tab changed the
  // URL and the page stayed on drama.
  const isDramaCanvas = data.search?.kind === 'drama';

  return (
    <Suspense
      fallback={
        <div
          className="grid h-full min-h-[60vh] place-items-center"
          data-workspace-loading="true"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 animate-spin rounded-full border-2 border-ink/12 border-t-ink/55" />
            <p className="text-[13px] text-[var(--beat-text-2)]">{data.project.name}</p>
          </div>
        </div>
      }
    >
      <ProductPageShell
        workspaceName={data.project.name}
        projectId={data.project.id}
        workspaceMode={data.workspaceMode}
      >
        {data.workspaceMode === 'studio' ? (
          <BeatStudioWorkspace
            key={data.project.id}
            projectId={data.project.id}
            initialTarget={data.target}
            initialModelId={data.modelId}
            initialPrompt={data.prompt}
          />
        ) : data.workspaceMode === 'assets' ? (
          <ProjectAssetsWorkspace key={data.project.id} projectId={data.project.id} />
        ) : data.workspaceMode === 'editor' ? (
          <VideoEditorWorkspace
            key={data.project.id}
            projectId={data.project.id}
            projectName={data.project.name}
          />
        ) : isDramaCanvas ? (
          <DramaCanvasRoute
            key={data.project.id}
            projectId={data.project.id}
            snapshot={data.snapshot}
            snapshotVersion={data.snapshotVersion}
          />
        ) : (
          <BeatCanvasShell
            key={data.project.id}
            projectId={data.project.id}
            projectPath={data.projectPath}
            initialProjectSnapshot={data.snapshot}
            initialProjectSnapshotVersion={data.snapshotVersion}
            initialTarget={data.target}
            initialModelId={data.modelId}
            initialPrompt={data.prompt}
            initialFocusCardId={data.focusCardId}
          />
        )}
      </ProductPageShell>
    </Suspense>
  );
}

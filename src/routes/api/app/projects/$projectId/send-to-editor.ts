import { createFileRoute } from '@tanstack/react-router';

import { createProject } from '@/core/projects/projects';
import {
  getProjectAssetById,
  linkProjectAsset,
} from '@/core/workspace-lib/assets/user-assets';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

/**
 * Hand a finished film to the editor.
 *
 * The two workspaces were disconnected: a drama render lived on the board and the
 * timeline could not see it. The asset itself is not copied — it is linked into a
 * fresh editor project, so opening that project shows the film ready to cut.
 */
async function POST({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) {
    return Response.json({ error: trust.message }, { status: trust.status });
  }

  const payload = (await request.json().catch(() => null)) as {
    assetId?: unknown;
    name?: unknown;
  } | null;
  const assetId = typeof payload?.assetId === 'string' ? payload.assetId : '';
  if (!assetId) return Response.json({ error: 'No asset to hand over' }, { status: 400 });

  const asset = await getProjectAssetById({ projectId: params.projectId, assetId });
  if (!asset) return Response.json({ error: 'Asset not found' }, { status: 404 });
  if (!String(asset.mimeType ?? '').startsWith('video/')) {
    return Response.json({ error: 'Only video can go to the editor' }, { status: 400 });
  }

  const rawName = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const project = await createProject({
    name: rawName || 'Edit',
    workspaceMode: 'editor',
  });

  await linkProjectAsset({
    projectId: project.id,
    assetId,
    role: 'generated',
  });

  return Response.json({ projectId: project.id, assetUrl: asset.publicUrl });
}

export const Route = createFileRoute('/api/app/projects/$projectId/send-to-editor')({
  server: { handlers: { POST } },
});

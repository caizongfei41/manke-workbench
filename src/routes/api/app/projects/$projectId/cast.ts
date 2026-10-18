import { createFileRoute } from '@tanstack/react-router';

import { copyAssetIntoProject, decodeLibraryName, findCastLibraryId } from '@/core/app/cast-library';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

/**
 * Bring one cast-library portrait into this project.
 *
 * The bytes are copied, so the board keeps working even if the library entry is
 * later removed.
 */
async function POST({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });

  const payload = (await request.json().catch(() => null)) as {
    libraryAssetId?: unknown;
    name?: unknown;
  } | null;
  const libraryAssetId =
    typeof payload?.libraryAssetId === 'string' ? payload.libraryAssetId : '';
  if (!libraryAssetId) return Response.json({ error: 'libraryAssetId is required' }, { status: 400 });

  const libraryId = await findCastLibraryId();
  const requestedName = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const copied = await copyAssetIntoProject({
    fromProjectId: libraryId,
    assetId: libraryAssetId,
    toProjectId: params.projectId,
    filename: requestedName ? `${requestedName}.png` : `${decodeLibraryName(libraryAssetId)}.png`,
  });
  if (!copied) return Response.json({ error: 'Library asset is not local' }, { status: 400 });

  return Response.json(copied);
}

export const Route = createFileRoute('/api/app/projects/$projectId/cast')({
  server: { handlers: { POST } },
});

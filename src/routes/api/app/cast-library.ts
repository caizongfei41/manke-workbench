import { createFileRoute } from '@tanstack/react-router';

import {
  copyAssetIntoProject,
  encodeLibraryFilename,
  findCastLibraryId,
  listCastLibrary,
} from '@/core/app/cast-library';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

/** List the shared cast, and add one portrait to it from any project. */

async function GET() {
  const items = await listCastLibrary();
  return Response.json({ items });
}

async function POST({ request }: { request: Request }) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });

  const payload = (await request.json().catch(() => null)) as {
    sourceProjectId?: unknown;
    assetId?: unknown;
    name?: unknown;
  } | null;

  const sourceProjectId = typeof payload?.sourceProjectId === 'string' ? payload.sourceProjectId : '';
  const assetId = typeof payload?.assetId === 'string' ? payload.assetId : '';
  const name = typeof payload?.name === 'string' ? payload.name : '';
  if (!sourceProjectId || !assetId || !name.trim()) {
    return Response.json({ error: 'sourceProjectId, assetId and name are required' }, { status: 400 });
  }

  const libraryId = await findCastLibraryId();
  const copied = await copyAssetIntoProject({
    fromProjectId: sourceProjectId,
    assetId,
    toProjectId: libraryId,
    filename: encodeLibraryFilename({ name, filename: `${assetId}.png` }),
  });
  if (!copied) return Response.json({ error: 'Asset is not local' }, { status: 400 });

  return Response.json({ ...copied, name: name.trim() });
}

export const Route = createFileRoute('/api/app/cast-library')({
  server: { handlers: { GET, POST } },
});

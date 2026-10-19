import { createFileRoute } from '@tanstack/react-router';
import { unlink } from 'node:fs/promises';

import { getDb } from '@/core/workspace-lib/db-adapter';
import { userAsset } from '@/config/db/schema';
import { inArray } from 'drizzle-orm';
import {
  LOCAL_PROJECT_ASSET_PROVIDER,
  resolveLocalProjectAssetPath,
} from '@/core/projects/local-project-assets';
import { deleteUserAssetById } from '@/core/workspace-lib/assets/user-assets';
import { validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';

/**
 * Delete assets from anywhere, which the library needs because a library is where you
 * notice you have three hundred of them.
 *
 * The row and the bytes behind it both go: deleting only the row leaves files on disk
 * with nothing pointing at them, which is how a data directory quietly fills up.
 */

const MAX_DELETE = 200;

async function DELETE({ request }: { request: Request }) {
  const trust = validateTrustedWorkspaceMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });

  let payload: { assetIds?: unknown };
  try {
    payload = (await request.json()) as { assetIds?: unknown };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const requested = Array.isArray(payload.assetIds)
    ? payload.assetIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const assetIds = [...new Set(requested)].slice(0, MAX_DELETE);

  if (assetIds.length === 0) {
    return Response.json({ error: 'assetIds is required' }, { status: 400 });
  }

  const db = await getDb();
  const rows = await db
    .select({
      id: userAsset.id,
      storageProvider: userAsset.storageProvider,
      objectKey: userAsset.objectKey,
    })
    .from(userAsset)
    .where(inArray(userAsset.id, assetIds));

  let filesRemoved = 0;
  for (const row of rows) {
    if (row.storageProvider !== LOCAL_PROJECT_ASSET_PROVIDER) continue;
    if (!row.objectKey) continue;
    try {
      await unlink(resolveLocalProjectAssetPath({ objectKey: row.objectKey }));
      filesRemoved += 1;
    } catch {
      // A missing file is not a reason to keep the row around.
    }
  }

  for (const row of rows) {
    await deleteUserAssetById(row.id);
  }

  return Response.json({ deleted: rows.length, filesRemoved });
}

export const Route = createFileRoute('/api/app/assets')({
  server: { handlers: { DELETE } },
});

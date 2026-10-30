import { createFileRoute } from '@tanstack/react-router';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { project, projectAssetMembership, userAsset } from '@/config/db/schema';
import { SHOWCASE_PROJECT_NAME } from '@/core/showcase/curation';
import { and, eq } from 'drizzle-orm';

/**
 * Manage what the front page shows.
 *
 * The carousel is driven by the curated project, so "put this on the cover" is not a
 * separate concept — it is membership in that project. This endpoint owns the two things
 * a user actually wants to do:
 *
 *   POST   add an asset to the curated project (upload already placed the file)
 *   PATCH  hide / unhide, or pin to a slot
 *   DELETE take it off the front page without deleting the asset itself
 *
 * Hiding is recorded in the asset's metadata rather than as a row deletion: a built-in
 * frame the user swapped out should stop appearing but must survive reinstall, and a
 * deletion would be undone by the next seed run.
 */

type Body = {
  assetId?: string;
  hidden?: boolean;
  order?: number | null;
};

const curatedProjectId = async () => {
  const db = await getDb();
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.name, SHOWCASE_PROJECT_NAME))
    .limit(1);
  return rows[0]?.id ?? null;
};

const readMetadata = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
};

async function GET() {
  const db = await getDb();
  const projectId = await curatedProjectId();
  if (!projectId) return Response.json({ projectId: null, items: [] });

  const rows = await db
    .select({
      id: userAsset.id,
      filename: userAsset.filename,
      type: userAsset.type,
      publicUrl: userAsset.publicUrl,
      source: userAsset.source,
      metadata: userAsset.metadata,
      createdAt: userAsset.createdAt,
    })
    .from(userAsset)
    .innerJoin(projectAssetMembership, eq(projectAssetMembership.assetId, userAsset.id))
    .where(eq(projectAssetMembership.projectId, projectId));

  return Response.json({ projectId, items: rows });
}

async function POST({ request }: { request: Request }) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const assetId = body.assetId?.trim();
  if (!assetId) return Response.json({ error: 'assetId required' }, { status: 400 });

  const db = await getDb();
  let projectId = await curatedProjectId();

  // Create the project when missing: a first add from the UI is a normal path.
  if (!projectId) {
    projectId = 'proj_showcase_builtin';
    const now = Date.now();
    await db
      .insert(project)
      .values({ id: projectId, name: SHOWCASE_PROJECT_NAME, status: 'active', createdAt: new Date(now), updatedAt: new Date(now) })
      .onConflictDoNothing();
  }

  const existing = await db
    .select({ id: projectAssetMembership.id })
    .from(projectAssetMembership)
    .where(
      and(
        eq(projectAssetMembership.projectId, projectId),
        eq(projectAssetMembership.assetId, assetId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(projectAssetMembership).values({
      id: `mem_showcase_${assetId}`,
      projectId,
      assetId,
      category: 'showcase',
      createdAt: new Date(),
    });
  }

  // Clear hidden on add, or it joins the project and stays invisible.
  const rows = await db
    .select({ metadata: userAsset.metadata })
    .from(userAsset)
    .where(eq(userAsset.id, assetId))
    .limit(1);
  if (rows.length > 0) {
    const metadata = readMetadata(rows[0].metadata);
    const showcase = { ...(readMetadata(metadata.showcase) as Record<string, unknown>), hidden: false };
    await db
      .update(userAsset)
      .set({ metadata: { ...metadata, showcase }, updatedAt: new Date() })
      .where(eq(userAsset.id, assetId));
  }

  return Response.json({ ok: true, projectId });
}

async function PATCH({ request }: { request: Request }) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const assetId = body.assetId?.trim();
  if (!assetId) return Response.json({ error: 'assetId required' }, { status: 400 });

  const db = await getDb();
  const rows = await db
    .select({ metadata: userAsset.metadata })
    .from(userAsset)
    .where(eq(userAsset.id, assetId))
    .limit(1);
  if (rows.length === 0) return Response.json({ error: 'asset not found' }, { status: 404 });

  const metadata = readMetadata(rows[0].metadata);
  const showcase = { ...(readMetadata(metadata.showcase) as Record<string, unknown>) };

  if (typeof body.hidden === 'boolean') showcase.hidden = body.hidden;
  if (body.order === null) delete showcase.order;
  else if (typeof body.order === 'number' && Number.isFinite(body.order)) showcase.order = body.order;

  await db
    .update(userAsset)
    .set({ metadata: { ...metadata, showcase }, updatedAt: new Date() })
    .where(eq(userAsset.id, assetId));

  return Response.json({ ok: true });
}

async function DELETE({ request }: { request: Request }) {
  const url = new URL(request.url);
  const assetId = url.searchParams.get('assetId')?.trim();
  if (!assetId) return Response.json({ error: 'assetId required' }, { status: 400 });

  const db = await getDb();
  const projectId = await curatedProjectId();
  if (!projectId) return Response.json({ ok: true, removed: 0 });

  // Drop the membership only; the asset itself stays in the user library.
  const result = await db
    .delete(projectAssetMembership)
    .where(
      and(
        eq(projectAssetMembership.projectId, projectId),
        eq(projectAssetMembership.assetId, assetId)
      )
    );

  return Response.json({ ok: true, removed: 1 });
}

export const Route = createFileRoute('/api/app/showcase')({
  server: { handlers: { GET, POST, PATCH, DELETE } },
});

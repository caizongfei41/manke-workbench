import { createFileRoute } from '@tanstack/react-router';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { projectAssetMembership, userAsset, project } from '@/config/db/schema';
import { getProject } from '@/core/projects/projects';
import { and, desc, eq, isNotNull, type SQL } from 'drizzle-orm';

/**
 * Recent assets, either for one project or across all of them.
 *
 * The global form carries the project each asset came from: a library whose entire point
 * is "where is that image from" is useless without it.
 */

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

async function GET({ request }: { request: Request }) {
  const url = new URL(request.url);
  const db = await getDb();
  const projectId = url.searchParams.get('projectId')?.trim() || null;
  const requested = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (projectId) {
    const currentProject = await getProject({ projectId });
    if (!currentProject) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
  }

  const baseFields = {
    id: userAsset.id,
    publicUrl: userAsset.publicUrl,
    filename: userAsset.filename,
    width: userAsset.width,
    height: userAsset.height,
    createdAt: userAsset.createdAt,
    mimeType: userAsset.mimeType,
    assetClass: userAsset.assetClass,
    metadata: userAsset.metadata,
    projectId: projectAssetMembership.projectId,
    projectName: project.name,
  };

  const query = async (type: 'image' | 'video' | 'audio', withDuration: boolean) => {
    const where: SQL | undefined = projectId
      ? and(
          eq(projectAssetMembership.projectId, projectId),
          eq(userAsset.type, type),
          isNotNull(userAsset.publicUrl)
        )
      : and(eq(userAsset.type, type), isNotNull(userAsset.publicUrl));

    const fields = withDuration ? { ...baseFields, durationMs: userAsset.durationMs } : baseFields;

    // Scoped: membership is required, so the inner join is the filter itself.
    if (projectId) {
      return db
        .selectDistinct(fields)
        .from(userAsset)
        .innerJoin(projectAssetMembership, eq(projectAssetMembership.assetId, userAsset.id))
        .leftJoin(project, eq(project.id, projectAssetMembership.projectId))
        .where(where)
        .orderBy(desc(userAsset.createdAt))
        .limit(limit);
    }

    // Global: an asset with no project should still appear, so the join cannot filter.
    return db
      .select(fields)
      .from(userAsset)
      .leftJoin(projectAssetMembership, eq(projectAssetMembership.assetId, userAsset.id))
      .leftJoin(project, eq(project.id, projectAssetMembership.projectId))
      .where(where)
      .groupBy(userAsset.id)
      .orderBy(desc(userAsset.createdAt))
      .limit(limit);
  };

  const [images, videos, audios] = await Promise.all([
    query('image', false),
    query('video', true),
    query('audio', true),
  ]);

  return Response.json({ images, videos, audios });
}

export const Route = createFileRoute('/api/app/recent-assets')({
  server: {
    handlers: { GET },
  },
});

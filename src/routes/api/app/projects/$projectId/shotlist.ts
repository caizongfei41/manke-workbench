import { createFileRoute } from '@tanstack/react-router';

import { loadDramaDocument } from '@/core/drama/drama-document';
import { buildShotListCsv } from '@/core/drama/shotlist-csv';
import { loadProjectWithLatestSnapshot } from '@/core/projects/projects';

/** Serves the shot list as a downloadable CSV; the shape lives in core. */

async function GET({ params }: { params: { projectId: string } }) {
  const loaded = await loadProjectWithLatestSnapshot({ projectId: params.projectId });
  if (!loaded) return Response.json({ error: 'Project not found' }, { status: 404 });

  const drama = loadDramaDocument((loaded.snapshot as { drama?: string }).drama);
  const csv = buildShotListCsv(drama);

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="shotlist-${params.projectId.slice(0, 8)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

export const Route = createFileRoute('/api/app/projects/$projectId/shotlist')({
  server: { handlers: { GET } },
});
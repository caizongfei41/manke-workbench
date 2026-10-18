import { createFileRoute } from '@tanstack/react-router';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  resolveLocalProjectAssetPath,
} from '@/core/projects/local-project-assets';
import {
  LOCAL_PROJECT_ASSET_BUCKET,
  LOCAL_PROJECT_ASSET_PROVIDER,
  persistLocalProjectAsset,
} from '@/core/projects/local-project-assets';
import { getProject } from '@/core/projects/projects';
import {
  linkProjectAsset,
  recordUserAsset,
} from '@/core/workspace-lib/assets/user-assets';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

const run = promisify(execFile);

/** Video files already in the project can be concatenated without re-rendering. */
const MAX_CLIPS = 200;

const findFfmpeg = () => {
  const candidates = [
    process.env.BEATDESIGN_FFMPEG?.trim(),
    'E:\\ComfyUI\\python_embeded\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe',
    'ffmpeg',
  ].filter((value): value is string => !!value);
  return candidates[0];
};

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
  const { projectId } = params;
  const project = await getProject({ projectId });
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

  const payload = (await request.json().catch(() => null)) as {
    assetIds?: unknown;
  } | null;
  const assetIds = Array.isArray(payload?.assetIds)
    ? (payload.assetIds as unknown[]).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    : [];
  if (assetIds.length < 1) {
    return Response.json({ error: 'No clips to join' }, { status: 400 });
  }
  if (assetIds.length > MAX_CLIPS) {
    return Response.json({ error: `At most ${MAX_CLIPS} clips` }, { status: 400 });
  }

  const { getProjectAssetById } = await import(
    '@/core/workspace-lib/assets/user-assets'
  );
  const paths: string[] = [];
  for (const assetId of assetIds) {
    const asset = await getProjectAssetById({ projectId, assetId });
    if (!asset || asset.storageProvider !== 'local' || !asset.objectKey) {
      return Response.json(
        { error: `Clip ${assetId} is not a local asset` },
        { status: 400 }
      );
    }
    paths.push(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }));
  }

  const workDir = await mkdtemp(join(tmpdir(), 'manke-concat-'));
  const outFile = join(workDir, 'joined.mp4');
  try {
    // The concat demuxer needs a manifest; single quotes in paths are escaped.
    const listFile = join(workDir, 'clips.txt');
    await writeFile(
      listFile,
      paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    );

    // -c copy skips re-encoding: seconds instead of an hour, no quality loss.
    await run(findFfmpeg(), [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outFile,
    ]);

    const bytes = new Uint8Array(await readFile(outFile));
    const assetId = crypto.randomUUID();
    const filename = `joined-${Date.now()}.mp4`;
    const stored = await persistLocalProjectAsset({
      projectId,
      assetId,
      filename,
      mimeType: 'video/mp4',
      bytes,
    });
    await recordUserAsset({
      id: assetId,
      type: 'video',
      source: 'derived',
      bucket: LOCAL_PROJECT_ASSET_BUCKET,
      objectKey: stored.objectKey,
      publicUrl: stored.publicUrl,
      mimeType: 'video/mp4',
      sizeBytes: bytes.byteLength,
      filename,
      storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
      originProjectId: projectId,
    });
    await linkProjectAsset({ projectId, assetId, role: 'generated' });

    return Response.json({
      assetId,
      publicUrl: stored.publicUrl,
      clips: assetIds.length,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Join failed' },
      { status: 500 }
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export const Route = createFileRoute('/api/app/projects/$projectId/concat')({
  server: { handlers: { POST } },
});

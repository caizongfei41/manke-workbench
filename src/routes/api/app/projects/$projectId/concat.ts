import { createFileRoute } from '@tanstack/react-router';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  LOCAL_PROJECT_ASSET_BUCKET,
  LOCAL_PROJECT_ASSET_PROVIDER,
  persistLocalProjectAsset,
  resolveLocalProjectAssetPath,
} from '@/core/projects/local-project-assets';
import { getProject } from '@/core/projects/projects';
import {
  EXPORT_PRESETS,
  type ExportPresetId,
} from '@/core/drama/subtitles';
import {
  getProjectAssetById,
  linkProjectAsset,
  recordUserAsset,
} from '@/core/workspace-lib/assets/user-assets';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

const run = promisify(execFile);

/** Finished clips only; a film with more shots than this is a different problem. */
const MAX_CLIPS = 200;
const MAX_SUBTITLE_BYTES = 512 * 1024;

const FFMPEG =
  process.env.BEATDESIGN_FFMPEG?.trim() ??
  'E:\\ComfyUI\\python_embeded\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe';

const localPathFor = async ({
  projectId,
  assetId,
}: {
  projectId: string;
  assetId: string;
}) => {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.storageProvider !== 'local' || !asset.objectKey) return null;
  return resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
};

/**
 * Join the finished clips, optionally burn subtitles and mix a music bed.
 *
 * Plain concatenation uses `-c copy` (seconds, no quality loss); subtitles and
 * music force a re-encode of the video and audio tracks respectively.
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
  const { projectId } = params;
  const project = await getProject({ projectId });
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

  const payload = (await request.json().catch(() => null)) as {
    assetIds?: unknown;
    subtitles?: unknown;
    bgmAssetId?: unknown;
    bgmVolume?: unknown;
    exportPreset?: unknown;
  } | null;

  const assetIds = Array.isArray(payload?.assetIds)
    ? (payload.assetIds as unknown[]).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    : [];
  if (assetIds.length < 1) return Response.json({ error: 'No clips to join' }, { status: 400 });
  if (assetIds.length > MAX_CLIPS) {
    return Response.json({ error: `At most ${MAX_CLIPS} clips` }, { status: 400 });
  }

  const subtitleText = typeof payload?.subtitles === 'string' ? payload.subtitles : '';
  if (subtitleText.length > MAX_SUBTITLE_BYTES) {
    return Response.json({ error: 'Subtitle track too large' }, { status: 400 });
  }
  const presetId = typeof payload?.exportPreset === 'string' ? payload.exportPreset : 'source';
  const preset = EXPORT_PRESETS[(presetId as ExportPresetId) ?? 'source'] ?? EXPORT_PRESETS.source;
  const bgmAssetId = typeof payload?.bgmAssetId === 'string' ? payload.bgmAssetId : '';
  const rawVolume = typeof payload?.bgmVolume === 'number' ? payload.bgmVolume : 0.25;
  const bgmVolume = Math.min(2, Math.max(0, rawVolume));

  const clipPaths: string[] = [];
  for (const assetId of assetIds) {
    const path = await localPathFor({ projectId, assetId });
    if (!path) return Response.json({ error: `Clip ${assetId} is not local` }, { status: 400 });
    clipPaths.push(path);
  }

  let bgmPath: string | null = null;
  if (bgmAssetId) {
    bgmPath = await localPathFor({ projectId, assetId: bgmAssetId });
    if (!bgmPath) return Response.json({ error: 'Music track is not local' }, { status: 400 });
  }

  const workDir = await mkdtemp(join(tmpdir(), 'manke-render-'));
  const joined = join(workDir, 'joined.mp4');
  const outFile = join(workDir, 'final.mp4');

  try {
    if (clipPaths.length === 1) {
      await run(FFMPEG, ['-y', '-i', clipPaths[0], '-c', 'copy', joined]);
    } else {
      const listFile = join(workDir, 'clips.txt');
      await writeFile(
        listFile,
        clipPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n'),
        'utf8'
      );
      await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);
    }

    const wantsSubtitles = subtitleText.trim().length > 0;
    const wantsResize = preset.mode !== 'none';
    const needsReencode = wantsSubtitles || !!bgmPath || wantsResize;

    if (!needsReencode) {
      await run(FFMPEG, ['-y', '-i', joined, '-c', 'copy', outFile]);
    } else {
      const args = ['-y', '-i', joined];
      if (bgmPath) {
        // Loop the music to the film length; amix duration=first trims it.
        args.push('-stream_loop', '-1', '-i', bgmPath);
      }

      const filters: string[] = [];
      if (wantsResize) {
        // Scale up to fill, then centre-crop: a vertical cut with no bars.
        filters.push(
          `[0:v]scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height},setsar=1[scaled]`
        );
      }
      const videoBase = wantsResize ? '[scaled]' : '[0:v]';
      if (wantsSubtitles) {
        const assFile = join(workDir, 'subs.ass');
        await writeFile(assFile, subtitleText, 'utf8');
        // Backslashes and colons are separators inside a filter argument.
        const escaped = assFile.replace(/\\/g, '/').replace(/:/g, '\\:');
        filters.push(`${videoBase}subtitles='${escaped}'[v]`);
      }
      if (bgmPath) {
        filters.push(`[1:a]volume=${bgmVolume}[music]`);
        filters.push(`[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[a]`);
      }

      if (filters.length > 0) args.push('-filter_complex', filters.join(';'));
      args.push('-map', wantsSubtitles ? '[v]' : wantsResize ? '[scaled]' : '0:v');
      args.push('-map', bgmPath ? '[a]' : '0:a?');
      args.push(
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        outFile
      );
      await run(FFMPEG, args, { maxBuffer: 32 * 1024 * 1024 });
    }

    const bytes = new Uint8Array(await readFile(outFile));
    const assetId = crypto.randomUUID();
    const filename = `final-${Date.now()}.mp4`;
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
      subtitles: wantsSubtitles,
      music: !!bgmPath,
      preset: presetId,
      width: preset.width || null,
      height: preset.height || null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Render failed' },
      { status: 500 }
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export const Route = createFileRoute('/api/app/projects/$projectId/concat')({
  server: { handlers: { POST } },
});

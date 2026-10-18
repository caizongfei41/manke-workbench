import { readFile } from 'node:fs/promises';

import {
  LOCAL_PROJECT_ASSET_BUCKET,
  LOCAL_PROJECT_ASSET_PROVIDER,
  persistLocalProjectAsset,
  resolveLocalProjectAssetPath,
} from '@/core/projects/local-project-assets';
import { createProject, loadProjects } from '@/core/projects/projects';
import {
  getProjectAssetById,
  linkProjectAsset,
  listProjectAssets,
  recordUserAsset,
} from '@/core/workspace-lib/assets/user-assets';

/**
 * A cast library that outlives a single film.
 *
 * Characters were rebuilt from scratch for every project — generate a portrait,
 * upload it, repeat next time. The library is a dedicated project whose image
 * assets are the entries, which avoids a schema migration and reuses the asset
 * pipeline as-is. Bringing one into a film **copies the bytes** into that project,
 * so deleting or moving the source never breaks a finished board.
 */

export const CAST_LIBRARY_NAME = '漫客角色库';

/** `阿明__portrait.png` — the name travels in the filename. */
const NAME_SEPARATOR = '__';

export const encodeLibraryFilename = ({ name, filename }: { name: string; filename: string }) => {
  const clean = name.trim().replace(/[\r\n/\\]/g, ' ');
  if (!clean) return filename;
  return `${clean}${NAME_SEPARATOR}${filename.replace(/[\r\n/\\]/g, ' ')}`;
};

export const decodeLibraryName = (filename: string) => {
  const index = filename.indexOf(NAME_SEPARATOR);
  if (index <= 0) return filename;
  return filename.slice(0, index);
};

/** The library project, created on first use. */
export const findCastLibraryId = async (): Promise<string> => {
  const projects = await loadProjects({ limit: 200 });
  const existing = projects.find((entry: { name: string }) => entry.name === CAST_LIBRARY_NAME);
  if (existing) return existing.id;
  const created = await createProject({ name: CAST_LIBRARY_NAME, workspaceMode: 'assets' });
  return created.id;
};

export type CastLibraryItem = { assetId: string; name: string; url: string; filename: string };

export const listCastLibrary = async (): Promise<CastLibraryItem[]> => {
  const libraryId = await findCastLibraryId();
  const assets = await listProjectAssets({ projectId: libraryId, limit: 200 });
  return assets
    .filter((asset: { type: string; publicUrl?: string | null }) => asset.type === 'image' && asset.publicUrl)
    .map((asset: { id: string; publicUrl?: string | null; filename?: string | null }) => ({
      assetId: asset.id,
      name: decodeLibraryName(asset.filename ?? ''),
      url: asset.publicUrl as string,
      filename: asset.filename ?? '',
    }));
};

/**
 * Copy one local asset into another project.
 *
 * Reads the stored bytes and writes a fresh asset, rather than re-pointing a URL:
 * a board that references another project's file breaks the moment that project is
 * deleted or re-created.
 */
export const copyAssetIntoProject = async ({
  fromProjectId,
  assetId,
  toProjectId,
  filename,
}: {
  fromProjectId: string;
  assetId: string;
  toProjectId: string;
  filename: string;
}): Promise<{ assetId: string; url: string } | null> => {
  const source = await getProjectAssetById({ projectId: fromProjectId, assetId });
  if (!source || source.storageProvider !== 'local' || !source.objectKey) return null;

  const bytes = new Uint8Array(
    await readFile(resolveLocalProjectAssetPath({ objectKey: source.objectKey }))
  );
  const mimeType = source.mimeType ?? 'image/png';
  const nextAssetId = crypto.randomUUID();

  const stored = await persistLocalProjectAsset({
    projectId: toProjectId,
    assetId: nextAssetId,
    filename,
    mimeType,
    bytes,
  });
  await recordUserAsset({
    id: nextAssetId,
    type: 'image',
    source: 'derived',
    bucket: LOCAL_PROJECT_ASSET_BUCKET,
    objectKey: stored.objectKey,
    publicUrl: stored.publicUrl,
    mimeType,
    sizeBytes: bytes.byteLength,
    filename,
    storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
    originProjectId: toProjectId,
  });
  await linkProjectAsset({ projectId: toProjectId, assetId: nextAssetId, role: 'reference' });

  return { assetId: nextAssetId, url: stored.publicUrl };
};

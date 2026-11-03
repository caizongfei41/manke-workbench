import { createFileRoute } from '@tanstack/react-router';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { getBeatDesignDataRoot } from '@/config/data-root';

/**
 * Trash.
 *
 * Deleting a project does not erase anything: asset directories move under
 * trash/project-assets and asset rows get a deletedAt stamp. Restoring just
 * undoes those two steps.
 *
 * Retention is 7 days. Expired entries are swept on every GET -- a local
 * single-user app has no daemon, and hanging cleanup off a read is the most
 * reliable trigger available.
 */

const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const trashRoot = () => join(getBeatDesignDataRoot(), 'trash', 'project-assets');
const assetsRoot = () => join(getBeatDesignDataRoot(), 'assets');

type TrashEntry = {
  id: string;
  /** 'project' = a whole project was deleted; 'asset' = a single asset */
  kind: 'project' | 'asset';
  name: string;
  bytes: number;
  files: number;
  deletedAt: string;
  /** Days left before the automatic sweep */
  expiresInDays: number;
  expired: boolean;
};

const measure = (dir: string) => {
  let bytes = 0;
  let files = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const inner = measure(path);
        bytes += inner.bytes;
        files += inner.files;
      } else {
        bytes += statSync(path).size;
        files += 1;
      }
    }
  } catch {
    /* the directory may have just been swept */
  }
  return { bytes, files };
};

/** mtime is a good enough stand-in for the delete time; nothing touches it after the move. */
const movedAtOf = (dir: string): Date => {
  try {
    return statSync(dir).mtime;
  } catch {
    return new Date();
  }
};

/**
 * Remove entries past the retention window and erase their DB rows.
 *
 * Runs on every read; returns how many were removed so the UI can report it.
 * Deletion has to cover three places or the list keeps showing ghosts:
 *   · files under trash/project-assets
 *   · asset rows soft-deleted for that project
 *   · the project row itself (status='deleted')
 */
const sweepExpired = async (now = Date.now()): Promise<number> => {
  let removed = 0;
  const expiredIds: string[] = [];

  // Files on disk
  const root = trashRoot();
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(root, entry.name);
      const movedAt = movedAtOf(full);
      if (now - movedAt.getTime() >= RETENTION_MS) {
        try {
          rmSync(full, { recursive: true, force: true });
          expiredIds.push(entry.name);
          removed += 1;
        } catch {
          /* file still open; the next sweep gets it */
        }
      }
    }
  }

  // Rows past their retention. Projects with no files on disk only die here.
  try {
    const { getDb } = await import('@/core/workspace-lib/db-adapter');
    const { project } = await import('@/config/db/schema');
    const { eq } = await import('drizzle-orm');

    const db = await getDb();
    const rows = await db
      .select({ id: project.id, deletedAt: project.deletedAt })
      .from(project)
      .where(eq(project.status, 'deleted'));

    for (const row of rows) {
      const at = row.deletedAt as Date | null;
      if (!at || now - at.getTime() < RETENTION_MS) continue;
      try {
        await purgeProject(row.id);
        if (!expiredIds.includes(row.id)) removed += 1;
      } catch {
        /* try again next read */
      }
    }
  } catch {
    /* no DB access: sweep disk only */
  }

  return removed;
};

/** Move a trash directory back to assets/<projectId>/ */
const restoreDir = (trashDir: string): { ok: boolean; message?: string } => {
  const projectId = basename(trashDir);
  const dest = join(assetsRoot(), projectId);
  try {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(trashDir, { withFileTypes: true })) {
      const from = join(trashDir, entry.name);
      const to = join(dest, entry.name);
      if (entry.isDirectory()) {
        // copy then remove instead of rename: works across volumes
        copyRecursive(from, to);
      } else {
        copyFileSync(from, to);
      }
    }
    rmSync(trashDir, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

function copyRecursive(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyRecursive(src, dst);
    else copyFileSync(src, dst);
  }
}

/**
 * Clear the soft-delete marks.
 *
 * The trash directory name is the projectId, so a restore can fix both:
 *   project.status 'deleted' -> 'active', clear deletedAt
 *   asset.deleted_at non-null -> null
 */
/**
 * Projects sitting in the trash according to the database.
 *
 * This is the source of truth for "what did the user delete". Reading only the
 * trash directory misses projects that had no asset files: deleting one moves
 * nothing to disk, so the trash looked empty even though the delete took.
 */
async function listDeletedProjects(): Promise<
  { id: string; name: string; deletedAt: Date | null }[]
> {
  const { getDb } = await import('@/core/workspace-lib/db-adapter');
  const { project } = await import('@/config/db/schema');
  const { eq } = await import('drizzle-orm');

  const db = await getDb();
  const rows = await db
    .select({ id: project.id, name: project.name, deletedAt: project.deletedAt })
    .from(project)
    .where(eq(project.status, 'deleted'));

  return rows.map((r: { id: string; name: string | null; deletedAt: Date | null }) => ({
    id: r.id,
    name: r.name ?? r.id,
    deletedAt: r.deletedAt ?? null,
  }));
}

/**
 * Erase a project and its assets from the database.
 *
 * Called when a trash entry is deleted for good, and by the 7-day sweep. The
 * files are already gone by then, so this is the last step.
 */
async function purgeProject(projectId: string) {
  const { getDb } = await import('@/core/workspace-lib/db-adapter');
  const { project, userAsset, projectAssetMembership } = await import('@/config/db/schema');
  const { eq } = await import('drizzle-orm');

  const db = await getDb();
  await db.delete(projectAssetMembership).where(eq(projectAssetMembership.projectId, projectId));
  await db.delete(userAsset).where(eq(userAsset.originProjectId, projectId));
  await db.delete(project).where(eq(project.id, projectId));
}

/** Is this a project currently sitting in the trash per the database? */
async function projectExistsAsDeleted(projectId: string): Promise<boolean> {
  const { getDb } = await import('@/core/workspace-lib/db-adapter');
  const { project } = await import('@/config/db/schema');
  const { and, eq } = await import('drizzle-orm');

  const db = await getDb();
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.status, 'deleted')))
    .limit(1);
  return rows.length > 0;
}

async function restoreRecords(projectId: string) {  const { getDb } = await import('@/core/workspace-lib/db-adapter');
  const { project, userAsset } = await import('@/config/db/schema');
  const { eq, isNotNull, and } = await import('drizzle-orm');

  const db = await getDb();
  const now = new Date();

  await db
    .update(project)
    .set({ status: 'active', deletedAt: null, updatedAt: now })
    .where(eq(project.id, projectId));

  // only assets that belong to this project and were actually soft-deleted
  await db
    .update(userAsset)
    .set({ deletedAt: null, updatedAt: now })
    .where(and(eq(userAsset.originProjectId, projectId), isNotNull(userAsset.deletedAt)));
}

export const Route = createFileRoute('/api/app/trash')({
  server: {
    handlers: {
      /** List the trash, sweeping expired entries first. */
      GET: async () => {
        const swept = await sweepExpired();
        const now = Date.now();
        const entries: TrashEntry[] = [];
        const seen = new Set<string>();

        // 1. Projects with status='deleted' in the database.
        //
        // This is the real source of truth. Reading only the disk misses projects
        // with no asset files: deleting one moves nothing into the trash, so the
        // list looked empty even though the delete had taken effect.
        try {
          const dbEntries = await listDeletedProjects();
          for (const p of dbEntries) {
            const diskDir = join(trashRoot(), p.id);
            const { bytes, files } = existsSync(diskDir) ? measure(diskDir) : { bytes: 0, files: 0 };
            const deletedAt = p.deletedAt ?? new Date();
            const left = Math.max(0, RETENTION_MS - (now - deletedAt.getTime()));
            entries.push({
              id: p.id,
              kind: 'project',
              name: p.name,
              bytes,
              files,
              deletedAt: deletedAt.toISOString(),
              expiresInDays: Math.ceil(left / (24 * 60 * 60 * 1000)),
              expired: left === 0,
            });
            seen.add(p.id);
          }
        } catch {
          /* no DB access: report disk entries only */
        }

        // 2. Directories on disk with no matching project row.
        //
        // Legacy deletes moved files without touching the database. Listing them
        // keeps them findable and clearable.
        try {
          for (const entry of readdirSync(trashRoot(), { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            // Directory names are <projectId> or <projectId>-<base36 stamp>
            const baseId = entry.name.includes('-')
              ? entry.name.replace(/-[0-9a-z]+$/, '')
              : entry.name;
            if (seen.has(entry.name) || seen.has(baseId)) continue;
            const full = join(trashRoot(), entry.name);
            const { bytes, files } = measure(full);
            const movedAt = movedAtOf(full);
            const left = Math.max(0, RETENTION_MS - (now - movedAt.getTime()));
            entries.push({
              id: entry.name,
              kind: 'project',
              name: entry.name,
              bytes,
              files,
              deletedAt: movedAt.toISOString(),
              expiresInDays: Math.ceil(left / (24 * 60 * 60 * 1000)),
              expired: left === 0,
            });
          }
        } catch {
          /* missing directory just means empty */
        }

        entries.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));

        return Response.json({
          entries,
          count: entries.length,
          totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
          retentionDays: RETENTION_DAYS,
          swept,
        });
      },

      /** Restore. body: { id } -- move the directory back and clear the DB marks. */
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => ({}))) as { id?: string };
        const id = String(body.id ?? '').trim();
        if (!id) return Response.json({ ok: false, message: 'missing id' }, { status: 400 });
        // id comes from our own listing, but never splice it into a path blind
        if (id.includes('/') || id.includes('\\') || id.includes('..')) {
          return Response.json({ ok: false, message: 'invalid id' }, { status: 400 });
        }

        const dir = join(trashRoot(), id);

        // A missing directory is normal: deleting a project with no assets
        // creates nothing under trash/, so the entry lives only in the database.
        // Restoring it just flips status back. Only when neither exists is it gone.
        if (existsSync(dir)) {
          // Move files back first, then touch the DB: doing it the other way round
          // leaves records claiming "restored" while files sit in the trash.
          const result = restoreDir(dir);
          if (!result.ok) {
            return Response.json(result, { status: 500 });
          }
        }

        let knownProject = false;
        try {
          knownProject = await projectExistsAsDeleted(id);
        } catch {
          knownProject = false;
        }
        if (!existsSync(dir) && !knownProject) {
          return Response.json(
            { ok: false, message: 'that entry is no longer in the trash' },
            { status: 404 }
          );
        }

        try {
          await restoreRecords(id);
        } catch (error) {
          // Files are back but the DB did not flip; report it as partial success
          return Response.json(
            {
              ok: true,
              warning: `files restored, but the database marks were not cleared: ${error instanceof Error ? error.message : String(error)}`,
            },
            { status: 200 }
          );
        }

        return Response.json({ ok: true });
      },

      /** Delete permanently. body: { id }, or { all: true } to empty. */
      DELETE: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          id?: string;
          all?: boolean;
        };

        if (body.all) {
          const root = trashRoot();
          if (!existsSync(root)) return Response.json({ ok: true, removed: 0 });
          let removed = 0;
          for (const entry of readdirSync(root, { withFileTypes: true })) {
            try {
              rmSync(join(root, entry.name), { recursive: true, force: true });
              removed += 1;
            } catch {
              /* in use; skip */
            }
          }
          return Response.json({ ok: true, removed });
        }

        const id = String(body.id ?? '').trim();
        if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
          return Response.json({ ok: false, message: 'missing or invalid id' }, { status: 400 });
        }
        const dir = join(trashRoot(), id);

        // Remove the directory if present; otherwise the row is all there is (see purgeProject below)
        if (existsSync(dir)) {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch (error) {
            return Response.json(
              { ok: false, message: error instanceof Error ? error.message : String(error) },
              { status: 500 }
            );
          }
        }

        // Erase the project and its assets for good. 7-day expiry takes this path too.

        try {
          await purgeProject(id);
        } catch (error) {
          return Response.json(
            {
              ok: false,
              message: `files removed, but the database row survived: ${error instanceof Error ? error.message : String(error)}`,
            },
            { status: 500 }
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});

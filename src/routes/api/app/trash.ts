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
 * Remove entries past the retention window.
 *
 * Runs on every read; returns how many were removed so the UI can say so.
 */
const sweepExpired = (now = Date.now()): number => {
  const root = trashRoot();
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(root, entry.name);
    const movedAt = movedAtOf(full);
    if (now - movedAt.getTime() >= RETENTION_MS) {
      try {
        rmSync(full, { recursive: true, force: true });
        removed += 1;
      } catch {
        /* file still open; the next sweep gets it */
      }
    }
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
async function restoreRecords(projectId: string) {
  const { getDb } = await import('@/core/workspace-lib/db-adapter');
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
        const swept = sweepExpired();
        const root = trashRoot();
        const now = Date.now();
        let entries: TrashEntry[] = [];

        try {
          entries = readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => {
              const full = join(root, entry.name);
              const { bytes, files } = measure(full);
              const movedAt = movedAtOf(full);
              const age = now - movedAt.getTime();
              const left = Math.max(0, RETENTION_MS - age);
              return {
                id: entry.name,
                kind: 'project' as const,
                name: entry.name,
                bytes,
                files,
                deletedAt: movedAt.toISOString(),
                expiresInDays: Math.ceil(left / (24 * 60 * 60 * 1000)),
                expired: left === 0,
              };
            })
            .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
        } catch {
          entries = [];
        }

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
        if (!existsSync(dir)) {
          return Response.json({ ok: false, message: 'that entry is no longer in the trash' }, { status: 404 });
        }

        // Move files back first, then touch the DB: doing it the other way round
        // leaves records claiming "restored" while files sit in the trash.
        const result = restoreDir(dir);
        if (!result.ok) {
          return Response.json(result, { status: 500 });
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
        if (!existsSync(dir)) {
          return Response.json({ ok: false, message: 'that entry is no longer in the trash' }, { status: 404 });
        }
        try {
          rmSync(dir, { recursive: true, force: true });
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json(
            { ok: false, message: error instanceof Error ? error.message : String(error) },
            { status: 500 }
          );
        }
      },
    },
  },
});

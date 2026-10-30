import { createFileRoute } from '@tanstack/react-router';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getBeatDesignDataRoot } from '@/config/data-root';

/**
 * What the trash holds.
 *
 * Deletes in this app move directories here rather than removing them, so an accidental
 * sweep is recoverable. This endpoint is the only thing that reads the trash: it lists
 * entries with their size and age, and never touches the live asset tree.
 *
 * Resolved per request through the shared data root, so a workspace that relocates data
 * with BEATDESIGN_DATA_DIR keeps reading its own trash instead of a stale folder.
 */

const trashRoot = () => join(getBeatDesignDataRoot(), 'trash', 'project-assets');

type TrashEntry = {
  name: string;
  bytes: number;
  files: number;
  movedAt: string;
};

const measure = (dir: string) => {
  let bytes = 0;
  let files = 0;
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
  return { bytes, files };
};

export const Route = createFileRoute('/api/app/trash')({
  server: {
    handlers: {
      GET: async () => {
        let entries: TrashEntry[] = [];
        try {
          entries = readdirSync(trashRoot(), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => {
              const full = join(trashRoot(), entry.name);
              const { bytes, files } = measure(full);
              return {
                name: entry.name,
                bytes,
                files,
                movedAt: statSync(full).mtime.toISOString(),
              };
            })
            .sort((left, right) => right.movedAt.localeCompare(left.movedAt));
        } catch {
          entries = [];
        }

        const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
        return Response.json({
          entries: entries.slice(0, 200),
          count: entries.length,
          totalBytes,
        });
      },
    },
  },
});

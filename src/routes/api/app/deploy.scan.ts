import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createFileRoute } from '@tanstack/react-router';

/**
 * Find deploy-bundle volumes in the places downloads usually land.
 *
 * GET -> { candidates: [{ dir, count, bytes, complete, missing }] }
 *
 * Nobody remembers where a 211 GB cloud download went. The Quark client
 * defaults to Downloads\manke-big, a browser may drop it straight into
 * Downloads, and someone extracting by hand may stop after .001 and assume
 * that was the whole thing. Asking the user to type the folder path into a
 * text box is a worse answer than scanning the handful of likely places and
 * listing what is actually there.
 *
 * Only fixed locations are scanned, never the whole disk: walking 211 GB of
 * project data takes tens of seconds, while download folders are finite.
 */
/**
 * Candidate download locations.
 *
 * Built per request, not at module load. Caching this list meant a folder that
 * did not exist when the server started stayed invisible forever -- the exact
 * case here, where the user downloads after launching the console.
 */
const downloadDirs = () => {
  const user = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const home = process.env.HOME ?? user;
  const list = [
    join(user, 'Downloads', 'manke-big'),
    join(user, 'Downloads'),
    join(user, 'Desktop', 'manke-big'),
    join(user, 'Desktop'),
    'D:\\manke-big',
    'D:\\Downloads',
    'E:\\manke-big',
    'E:\\Downloads',
    'F:\\manke-big',
    'G:\\manke-big',
    // where the Quark client usually puts things
    join(user, 'Documents', 'Quark'),
    join(user, 'Quark'),
    join(home, 'Downloads'),
  ];
  return list.filter((d) => d && existsSync(d));
};

const VOLUME_RE = /^manke-bundle\.7z\.\d{3}$/;

type Candidate = {
  dir: string;
  count: number;
  bytes: number;
  complete: boolean;
  missing: number[];
};

const scan = (dir: string): Candidate | null => {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const vols = names.filter((n) => VOLUME_RE.test(n)).sort();
  if (vols.length === 0) return null;

  let bytes = 0;
  const found = new Set<number>();
  for (const n of vols) {
    const idx = Number(n.slice(-3));
    found.add(idx);
    try {
      bytes += statSync(join(dir, n)).size;
    } catch {
      /* a single unreadable file should not abort the size total */
    }
  }
  // Volume numbers run 1..max(7, highest seen); the packer currently emits 7.
  const max = Math.max(7, ...found);
  const missing: number[] = [];
  for (let i = 1; i <= max; i += 1) if (!found.has(i)) missing.push(i);

  return {
    dir,
    count: vols.length,
    bytes,
    complete: missing.length === 0,
    missing,
  };
};

async function GET() {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const dir of downloadDirs()) {
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = scan(dir);
    if (hit) candidates.push(hit);
  }

  // Complete sets first, then the ones with more volumes.
  candidates.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    return b.count - a.count;
  });

  return Response.json({ candidates });
}

export const Route = createFileRoute('/api/app/deploy/scan')({
  server: { handlers: { GET } },
});

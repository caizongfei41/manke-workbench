import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFileRoute } from '@tanstack/react-router';

/**
 * Environment readiness endpoint.
 *
 * GET -> runs scripts/check-environment.mjs --json and returns its verdict:
 *        whether the bundled templates have their custom node packages, model
 *        files, build output and a reachable ComfyUI.
 *
 * The check lives in the script rather than here so the desktop service console and
 * the web page report exactly the same thing. It reads docs/DEPENDENCIES.json, so
 * adding a template cannot fall out of the check silently.
 *
 * Fallback strings are English on purpose: this file sits under src/routes, which
 * check-i18n.mjs scans for hardcoded Chinese. User-facing wording belongs in the
 * script's output (data) or messages/*.json (UI chrome).
 */

const TIMEOUT_MS = 90_000;

/**
 * Repo root.
 *
 * Do NOT trust process.cwd() alone. The server can be launched through
 * Scheduled Task -> cmd -> node, and if any wrapper fails to set the working
 * directory, cwd ends up wherever the launcher happened to be. The check
 * script then looks for data/ under the wrong tree, fails to find the config,
 * falls back to a guessed ComfyUI path, and reports 「directory does not
 * exist」 for a machine that is perfectly set up.
 *
 * Resolution order:
 *   1. BEATDESIGN_ROOT, if the launcher set it
 *   2. Walk up from cwd looking for the repo marker
 *   3. Walk up from this module's own file URL (stable regardless of cwd)
 *   4. cwd as the last resort
 */
const hasMarker = (dir: string) => existsSync(join(dir, 'scripts', 'check-environment.mjs'));

const walkUp = (start: string): string | null => {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (hasMarker(dir)) return dir;
    const parent = join(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
};

const resolveRoot = () => {
  const explicit = process.env.BEATDESIGN_ROOT?.trim();
  if (explicit && hasMarker(explicit)) return explicit;

  const fromCwd = walkUp(process.cwd());
  if (fromCwd) return fromCwd;

  try {
    const here = fileURLToPath(import.meta.url);
    const fromModule = walkUp(dirname(here));
    if (fromModule) return fromModule;
  } catch {
    /* import.meta.url unavailable in some bundlers */
  }

  return explicit || process.cwd();
};

const runCheck = () =>
  new Promise<{ ok: boolean; raw: string; error?: string }>((resolve) => {
    const root = resolveRoot();
    const script = join(root, 'scripts', 'check-environment.mjs');

    if (!existsSync(script)) {
      resolve({ ok: false, raw: '', error: `Missing ${script}` });
      return;
    }

    execFile(
      process.execPath,
      [script, '--json'],
      { cwd: root, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        // The script signals its verdict through the exit code. A non-zero exit with
        // complete JSON on stdout still has to reach the UI — that JSON is exactly
        // the "what failed" content.
        if (stdout && stdout.trim().startsWith('{')) {
          resolve({ ok: true, raw: stdout });
          return;
        }
        resolve({
          ok: false,
          raw: '',
          error: error?.message ?? 'Check script produced no JSON output',
        });
      }
    );
  });

const failure = (label: string, detail: string, hint: string) =>
  Response.json(
    {
      ok: false,
      summary: { pass: 0, warn: 0, fail: 1 },
      checks: [{ id: 'runner', label, status: 'fail', detail, hint }],
    },
    { status: 200 }
  );

async function GET() {
  const result = await runCheck();

  if (!result.ok) {
    return failure(
      'Check runner',
      result.error ?? 'Failed to run',
      'Confirm scripts/check-environment.mjs exists'
    );
  }

  try {
    const parsed = JSON.parse(result.raw) as Record<string, unknown>;
    // Surface which directory the check actually ran against. When the server
    // is launched with a different working directory than the repo root, the
    // script reads a config that is not there, silently falls back to a guess,
    // and reports 「directory does not exist」 for a path the user never chose.
    // Without this field that failure looks identical to a genuinely missing
    // ComfyUI install.
    return Response.json({ ...parsed, checkedRoot: resolveRoot() });
  } catch {
    return failure(
      'Check runner',
      'Output was not valid JSON',
      'Run node scripts/check-environment.mjs manually to see the error'
    );
  }
}

export const Route = createFileRoute('/api/app/environment')({
  server: { handlers: { GET } },
});

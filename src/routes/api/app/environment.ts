import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

/** Repo root: the server is started from there by the launcher. */
const resolveRoot = () => process.env.BEATDESIGN_ROOT?.trim() || process.cwd();

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
    return Response.json(JSON.parse(result.raw) as Record<string, unknown>);
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

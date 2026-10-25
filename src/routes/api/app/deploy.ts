import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createFileRoute } from '@tanstack/react-router';

/**
 * One-click deploy endpoint.
 *
 * GET  -> report bundle state: are the volume sets complete, where does ComfyUI
 *         live (or where will it be installed), is anything blocking
 * POST -> start the deploy: extract 04, 01, 02, 03 in that order
 *
 * The extraction itself lives in scripts/deploy-bundle.mjs rather than here,
 * because the command line and the desktop console need the same logic. This
 * route only validates input and manages the process.
 *
 * Why the work is detached: extracting 197 GB takes well over half an hour, so
 * an HTTP request cannot hold it. POST starts a background process and the
 * frontend polls GET for progress, which the script writes to a JSON file.
 */

const ROOT = () => process.env.BEATDESIGN_ROOT?.trim() || process.cwd();
const SCRIPT = () => join(ROOT(), 'scripts', 'deploy-bundle.mjs');
const PROGRESS = () => join(ROOT(), '.verify', 'deploy-progress.json');
const DEPLOY_LOG = () => join(ROOT(), '.verify', 'deploy.log');

/** Progress is written by the script; read it back for the UI. */
type DeployProgress = {
  running: boolean;
  stage: string;
  detail: string;
  percent: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

const readProgress = async (): Promise<DeployProgress | null> => {
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(PROGRESS(), 'utf8')) as DeployProgress;
  } catch {
    return null;
  }
};

const runInspect = (bundleDir: string, comfyRoot?: string) =>
  new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolvePromise) => {
    const script = SCRIPT();
    if (!existsSync(script)) {
      resolvePromise({ ok: false, error: `Missing ${script}` });
      return;
    }
    const args = [script, '--bundle', bundleDir, '--json'];
    if (comfyRoot) args.push('--comfy', comfyRoot);
    execFile(
      process.execPath,
      args,
      { cwd: ROOT(), timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (stdout && stdout.trim().startsWith('{')) {
          try {
            resolvePromise({ ok: true, data: JSON.parse(stdout) });
            return;
          } catch {
            /* fall through */
          }
        }
        resolvePromise({ ok: false, error: error?.message ?? 'Inspect produced no JSON' });
      }
    );
  });

async function GET({ request }: { request: Request }) {
  const url = new URL(request.url);
  const bundleDir = url.searchParams.get('bundle') ?? join(ROOT(), 'deploy');
  const comfyRoot = url.searchParams.get('comfy') ?? undefined;

  const [inspect, progress] = await Promise.all([
    runInspect(resolve(bundleDir), comfyRoot ? resolve(comfyRoot) : undefined),
    readProgress(),
  ]);

  return Response.json({
    bundleDir: resolve(bundleDir),
    inspect: inspect.ok ? inspect.data : null,
    inspectError: inspect.ok ? null : inspect.error,
    progress,
  });
}

async function POST({ request }: { request: Request }) {
  let payload: { bundle?: string; comfy?: string } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    /* empty body: fall back to defaults */
  }

  const bundleDir = resolve(payload.bundle ?? join(ROOT(), 'deploy'));
  const script = SCRIPT();

  if (!existsSync(script)) {
    return Response.json({ error: `Missing ${script}` }, { status: 500 });
  }
  if (!existsSync(bundleDir)) {
    return Response.json({ error: `Deploy bundle not found: ${bundleDir}` }, { status: 400 });
  }

  // One deploy at a time: concurrent runs would overwrite each other's files.
  const current = await readProgress();
  if (current?.running) {
    return Response.json({ error: 'A deploy is already running', progress: current }, { status: 409 });
  }

  const args = [script, '--bundle', bundleDir, '--deploy'];
  if (payload.comfy) args.push('--comfy', resolve(payload.comfy));

  const { spawn } = await import('node:child_process');
  const { openSync } = await import('node:fs');
  const { mkdirSync, writeFileSync } = await import('node:fs');

  mkdirSync(join(ROOT(), '.verify'), { recursive: true });
  const logFd = openSync(DEPLOY_LOG(), 'w');

  // Seed the progress file so the first poll sees "started" rather than a stale result.
  writeFileSync(
    PROGRESS(),
    JSON.stringify({
      running: true,
      stage: 'starting',
      detail: 'Starting the extraction process',
      percent: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    } satisfies DeployProgress),
    'utf8'
  );

  const child = spawn(process.execPath, args, {
    cwd: ROOT(),
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  child.unref();

  return Response.json({ started: true, pid: child.pid, bundleDir, log: DEPLOY_LOG() });
}

export const Route = createFileRoute('/api/app/deploy')({
  server: { handlers: { GET, POST } },
});

import { existsSync } from 'node:fs';

import { createFileRoute } from '@tanstack/react-router';

import {
  comfyUiPython,
  comfyUiRoot,
  getServicesStatus,
  readComfyUiLog,
  setComfyUiRoot,
  startComfyUi,
  startLlama,
  stopComfyUi,
  stopLlama,
} from '@/core/services/service-manager';

/**
 * Unified service control endpoint for the Manke workbench.
 * GET  -> status of all local services (workbench / ComfyUI / llama)
 * POST -> start/stop a service ({ service: 'comfyui'|'llama', action: 'start'|'stop' })
 *
 * Start actions return immediately; the UI polls GET to track readiness.
 */

async function GET() {
  const status = await getServicesStatus();
  const log = readComfyUiLog(60);
  return Response.json({ ...status, comfyUiLog: log });
}

async function POST({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as {
      service?: string;
      action?: string;
      /** New ComfyUI root, used by action='setRoot'. */
      root?: string;
    };
    const service = body.service;
    const action = body.action;

    if (service === 'comfyui') {
      if (action === 'start') {
        // Check the obvious failures up front instead of logging them.
        //
        // This was void startComfyUi().catch(console.error) followed by an
        // unconditional ok:true: with no ComfyUI folder or python missing, the
        // UI still said "starting" and nothing ever happened, so people kept
        // clicking. A bad location is the only case that cannot start, so it
        // is rejected here where the caller can show it.
        const root = comfyUiRoot();
        const python = comfyUiPython();
        if (!root || !existsSync(python)) {
          return Response.json(
            {
              ok: false,
              code: 'COMFYUI_NOT_CONFIGURED',
              detail: !root ? '' : python,
            },
            { status: 409 }
          );
        }
        void startComfyUi().catch((error) =>
          console.error('[services] comfyui start failed:', error)
        );
        return Response.json({ ok: true, starting: true });
      }
      if (action === 'stop') {
        await stopComfyUi();
        return Response.json({ ok: true, stopping: true });
      }
      if (action === 'setRoot') {
        // Change the ComfyUI root. Validate that the folder really contains
        // python_embeded\python.exe first; write the config, then stop the
        // service so the new path takes effect on the next start.
        const root = String(body.root ?? '').trim();
        if (!root) {
          return Response.json({ ok: false, message: 'Empty path' });
        }
        const saved = setComfyUiRoot(root);
        if (!saved.ok) {
          return Response.json({ ok: false, message: saved.message });
        }
        await stopComfyUi();
        return Response.json({ ok: true, message: 'Saved. Restart ComfyUI to apply.' });
      }
    }

    if (service === 'llama') {
      if (action === 'start') {
        void startLlama().catch((error) =>
          console.error('[services] llama start failed:', error)
        );
        return Response.json({ ok: true, starting: true });
      }
      if (action === 'stop') {
        await stopLlama();
        return Response.json({ ok: true, stopping: true });
      }
    }

    return Response.json(
      { error: 'INVALID_REQUEST', detail: `service=${service} action=${action}` },
      { status: 400 }
    );
  } catch (error) {
    return Response.json(
      {
        error: 'SERVICE_ACTION_FAILED',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export const Route = createFileRoute('/api/app/services')({
  server: {
    handlers: { GET, POST },
  },
});

import { createFileRoute } from '@tanstack/react-router';

import {
  getServicesStatus,
  readComfyUiLog,
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
    };
    const service = body.service;
    const action = body.action;

    if (service === 'comfyui') {
      if (action === 'start') {
        void startComfyUi().catch((error) =>
          console.error('[services] comfyui start failed:', error)
        );
        return Response.json({ ok: true, starting: true });
      }
      if (action === 'stop') {
        await stopComfyUi();
        return Response.json({ ok: true, stopping: true });
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

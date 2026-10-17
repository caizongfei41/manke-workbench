import { createFileRoute } from '@tanstack/react-router';
import { getComfyUiPromptProgress } from '@/core/effects/comfyui-progress';
import { getGenerationById } from '@/core/effects/record-generation';
import { startBackendPollingForGeneration } from '@/core/effects/server-poller';

async function GET({ request }: { request: Request }) {
  const params = new URL(request.url).searchParams;
  const wmTaskId = params.get('wmTaskId');
  if (!wmTaskId) {
    return Response.json({ error: 'Missing wmTaskId' }, { status: 400 });
  }
  try {
    const generation = await getGenerationById({ id: wmTaskId });
    if (!generation) return Response.json({ error: 'Task not found' }, { status: 404 });
    if (generation.status === 'pending' || generation.status === 'processing') {
      startBackendPollingForGeneration({ wmTaskId, effectId: generation.effectId });
    }
    // Live step progress is only meaningful while the job is still running; it
    // comes from ComfyUI's WebSocket, not from the provider's stored output.
    const isBusy =
      generation.status === 'pending' || generation.status === 'processing';
    const output = generation.output as { providerTaskId?: unknown } | null;
    const providerTaskId =
      typeof output?.providerTaskId === 'string'
        ? output.providerTaskId
        : generation.providerTaskId;
    return Response.json({
      success: generation.status === 'succeeded',
      wmTaskId,
      status: generation.status,
      output: generation.output,
      error: generation.status === 'failed' ? generation.error ?? 'Generation failed.' : null,
      progress: isBusy ? getComfyUiPromptProgress(providerTaskId) : null,
    });
  } catch (cause) {
    console.error('effects.status error:', cause);
    return Response.json({ error: 'Failed to query task status.' }, { status: 500 });
  }
}

export const Route = createFileRoute('/api/effects/status')({
  server: { handlers: { GET } },
});

import { createFileRoute } from '@tanstack/react-router';
import { ensureLlamaServer, refreshIdleTimer } from '@/core/adapters/llm-manager';
import {
  H3_VIDEO_PROMPT_EN,
  QWEN_IMAGE_PROMPT_EN,
  QWEN_IMAGE_PROMPT_ZH,
} from '@/core/adapters/llm-prompts';

/**
 * Prompt enhance endpoint.
 * Starts the local llama.cpp server on demand (see llm-manager), calls its
 * OpenAI-compatible API to expand the draft prompt into a richer,
 * model-friendly description, then schedules the idle auto-stop.
 * The output format follows the official prompt guidance per media type:
 *   image  -> Qwen-Image 2.1 natural-language prompt style (zh/en selectable)
 *   video  -> MiniMax H3 (local weights) 6-part structured format (English)
 * Base URL and model name are configurable via env vars:
 *   BEATDESIGN_LLM_BASE_URL (default http://127.0.0.1:8080/v1)
 *   BEATDESIGN_LLM_MODEL   (default local-model)
 */

async function POST({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as {
      prompt?: string;
      model?: string;
      mediaType?: 'image' | 'video';
      language?: 'zh' | 'en';
    };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return Response.json({ error: 'EMPTY_PROMPT' }, { status: 400 });
    }
    const mediaType = body.mediaType === 'video' ? 'video' : 'image';
    const language = body.language === 'zh' ? 'zh' : 'en';
    const system =
      mediaType === 'video'
        ? H3_VIDEO_PROMPT_EN
        : language === 'zh'
          ? QWEN_IMAGE_PROMPT_ZH
          : QWEN_IMAGE_PROMPT_EN;

    await ensureLlamaServer();

    const baseUrl = (
      process.env.BEATDESIGN_LLM_BASE_URL ?? 'http://127.0.0.1:8080/v1'
    ).replace(/\/+$/, '');
    const model = process.env.BEATDESIGN_LLM_MODEL ?? body.model ?? 'local-model';

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 512,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return Response.json(
        { error: 'LLM_UNAVAILABLE', detail: `status ${res.status}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      return Response.json({ error: 'EMPTY_RESULT' }, { status: 502 });
    }
    refreshIdleTimer();
    return Response.json({ expanded: content });
  } catch (error) {
    return Response.json(
      {
        error: 'LLM_UNAVAILABLE',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}

export const Route = createFileRoute('/api/llm-enhance')({
  server: {
    handlers: { POST },
  },
});

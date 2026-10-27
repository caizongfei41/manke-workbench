import { createFileRoute } from '@tanstack/react-router';
import {
  apiKey,
  baseUrl as resolveBaseUrl,
  ensureLlamaServer,
  isRemoteProvider,
  refreshIdleTimer,
} from '@/core/adapters/llm-manager';
import {
  H3_VIDEO_PROMPT_EN,
  QWEN_IMAGE_PROMPT_EN,
  QWEN_IMAGE_PROMPT_ZH,
} from '@/core/adapters/llm-prompts';

/**
 * Prompt enhance endpoint.
 *
 * Expands a short draft into the prompt shape the target workflow expects:
 *   image  -> Qwen-Image 2.1 natural-language style (zh or en)
 *   video  -> MiniMax H3 six-part structured format (English)
 *
 * Works against either backend; the choice is made in llm-manager:
 *   remote  any OpenAI-compatible service. Nothing is spawned, and a bearer
 *           token is attached when BEATDESIGN_LLM_API_KEY is set.
 *   local   llama.cpp started on demand.
 */

/** Pick the system prompt for the requested media and output language. */
const pickSystemPrompt = (mediaType: 'image' | 'video', language: 'zh' | 'en') => {
  if (mediaType === 'video') return H3_VIDEO_PROMPT_EN;
  return language === 'zh' ? QWEN_IMAGE_PROMPT_ZH : QWEN_IMAGE_PROMPT_EN;
};

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
    const system = pickSystemPrompt(mediaType, language);

    await ensureLlamaServer();

    const url = `${resolveBaseUrl()}/chat/completions`;
    const key = apiKey();
    const model =
      process.env.BEATDESIGN_LLM_MODEL?.trim() ||
      body.model?.trim() ||
      (isRemoteProvider() ? 'deepseek-chat' : 'local-model');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
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
      // Carry the upstream body through. "status 401" on its own hides the
      // most common failures: wrong key, wrong model id, quota exhausted.
      const detail = await res.text().catch(() => '');
      return Response.json(
        {
          error: 'LLM_UNAVAILABLE',
          detail: `status ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`,
        },
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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFileRoute } from '@tanstack/react-router';

/**
 * Prompt-enhance configuration.
 *
 * GET  -> which backend is in use and whether it is reachable
 * POST -> persist { baseUrl, apiKey, model } to data/llm.config.json
 *
 * Why a config file instead of env vars only: the desktop console starts the
 * server, so a user who wants to switch from local llama.cpp to an online API
 * has no convenient place to put a key. Writing it here lets the settings UI
 * change it without editing shortcuts or restarting from a shell.
 *
 * The key is stored on disk in plain text. It never leaves this machine: the
 * server reads it and attaches it as a bearer token on the outbound request.
 * The GET response deliberately reports only whether a key is present, never
 * the value.
 */

const resolveRoot = () => {
  const explicit = process.env.BEATDESIGN_ROOT?.trim();
  if (explicit) return explicit;
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
      if (existsSync(join(dir, 'scripts', 'check-environment.mjs'))) return dir;
      const parent = join(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through */
  }
  return process.cwd();
};

const configPath = () => join(resolveRoot(), 'data', 'llm.config.json');

type LlmConfig = { baseUrl?: string; apiKey?: string; model?: string };

const readConfig = (): LlmConfig => {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8').replace(/^\uFEFF/, '')) as LlmConfig;
  } catch {
    return {};
  }
};

/** Apply the saved config to process.env so llm-manager sees it. */
export const applyStoredConfig = () => {
  const cfg = readConfig();
  if (cfg.baseUrl) process.env.BEATDESIGN_LLM_BASE_URL = cfg.baseUrl;
  if (cfg.apiKey) process.env.BEATDESIGN_LLM_API_KEY = cfg.apiKey;
  if (cfg.model) process.env.BEATDESIGN_LLM_MODEL = cfg.model;
};

async function GET() {
  applyStoredConfig();
  const { baseUrl, apiKey, isRemoteProvider } = await import('@/core/adapters/llm-manager');
  const url = baseUrl();
  const remote = isRemoteProvider();

  // Probe the endpoint so the UI can show reachable / unreachable instead of
  // guessing from the URL alone.
  let reachable = false;
  let probeError: string | null = null;
  try {
    const res = await fetch(`${url}/models`, {
      headers: apiKey() ? { Authorization: `Bearer ${apiKey()}` } : {},
      signal: AbortSignal.timeout(6000),
    });
    reachable = res.ok;
    if (!res.ok) probeError = `HTTP ${res.status}`;
  } catch (error) {
    probeError = error instanceof Error ? error.message : String(error);
  }

  return Response.json({
    baseUrl: url,
    model: process.env.BEATDESIGN_LLM_MODEL ?? '',
    hasApiKey: Boolean(apiKey()),
    remote,
    reachable,
    probeError,
  });
}

async function POST({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as LlmConfig;
    const baseUrl = String(body.baseUrl ?? '').trim();
    // An empty string is meaningful: it clears the key rather than keeping it.
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;
    const model = typeof body.model === 'string' ? body.model.trim() : undefined;

    const next: LlmConfig = {};
    if (baseUrl) next.baseUrl = baseUrl;
    if (apiKey !== undefined) next.apiKey = apiKey;
    if (model !== undefined) next.model = model;

    writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');

    // Reflect immediately so the next enhance call uses the new settings
    // without restarting the server.
    if (next.baseUrl) process.env.BEATDESIGN_LLM_BASE_URL = next.baseUrl;
    else delete process.env.BEATDESIGN_LLM_BASE_URL;
    if (next.apiKey) process.env.BEATDESIGN_LLM_API_KEY = next.apiKey;
    else delete process.env.BEATDESIGN_LLM_API_KEY;
    if (next.model) process.env.BEATDESIGN_LLM_MODEL = next.model;
    else delete process.env.BEATDESIGN_LLM_MODEL;

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}

export const Route = createFileRoute('/api/app/llm-config')({
  server: { handlers: { GET, POST } },
});

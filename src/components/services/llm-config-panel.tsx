'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, RefreshCw, Server, TriangleAlert } from 'lucide-react';

import { m } from '@/paraglide/messages.js';

/**
 * AI prompt-enhance backend settings.
 *
 * The enhance button needs an OpenAI-compatible endpoint. Two setups are
 * supported and this panel is the only place either can be configured without
 * editing shortcuts:
 *
 *   online  any hosted service (DeepSeek, Moonshot, ...). Needs a base URL and
 *           usually a key. This is the default now that local llama.cpp is an
 *           optional extra rather than a bundled dependency.
 *   local   a llama.cpp the app starts itself. No key, but a GGUF file must be
 *           on disk.
 *
 * Presets cover the common hosted endpoints so a user only has to paste a key.
 */

type LlmState = {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  remote: boolean;
  reachable: boolean;
  probeError: string | null;
};

/** Common OpenAI-compatible endpoints, plus the local llama.cpp default. */
const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'local', label: 'Local llama.cpp', baseUrl: 'http://127.0.0.1:8081/v1', model: 'local-model' },
] as const;

export function LlmConfigPanel() {
  const [state, setState] = useState<LlmState | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/app/llm-config', {
        headers: { 'x-beatapi-workspace-request': '1' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LlmState;
      setState(json);
      setBaseUrl(json.baseUrl);
      setModel(json.model);
      // Never echo the key back; leaving it blank means "keep the current one".
      setApiKey('');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/app/llm-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-beatapi-workspace-request': '1' },
        body: JSON.stringify({ baseUrl, apiKey, model }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
      await load();
      setTimeout(() => setSaved(false), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setSaved(false);
  };

  return (
    <section className="rounded-[18px] border border-[var(--beat-border)] bg-[var(--beat-surface)] p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--beat-accent)]/12 text-[var(--beat-accent)]">
          <Server className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-[var(--beat-text-1)]">
            {m['services.llm.title']()}
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--beat-text-2)]">
            {m['services.llm.subtitle']()}
          </p>
        </div>
        {state && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] ${
              state.reachable
                ? 'bg-[var(--beat-accent)]/12 text-[var(--beat-accent)]'
                : 'bg-[var(--beat-warn-text)]/12 text-[var(--beat-warn-text)]'
            }`}
          >
            {state.reachable ? m['services.llm.reachable']() : m['services.llm.unreachable']()}
          </span>
        )}
      </header>

      {/* Presets: the fastest path to a working setup. */}
      <div className="mb-4">
        <p className="mb-1.5 text-[12.5px] text-[var(--beat-text-2)]">
          {m['services.llm.preset']()}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                baseUrl === preset.baseUrl
                  ? 'border-[var(--beat-accent)] bg-[var(--beat-accent)]/10 text-[var(--beat-accent)]'
                  : 'border-[var(--beat-border)] text-[var(--beat-text-2)] hover:border-[var(--beat-text-3)]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 grid gap-2.5">
        <label className="block">
          <span className="mb-1 block text-[12.5px] text-[var(--beat-text-2)]">
            {m['services.llm.baseUrl']()}
          </span>
          <input
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setSaved(false);
            }}
            placeholder="https://api.deepseek.com/v1"
            className="h-9 w-full rounded-[8px] border border-[var(--beat-border)] bg-[var(--beat-control)] px-2.5 text-[13px] text-[var(--beat-text-1)] outline-none"
          />
        </label>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[12.5px] text-[var(--beat-text-2)]">
              <KeyRound className="size-3.5" />
              {m['services.llm.apiKey']()}
              {state?.hasApiKey && (
                <span className="text-[11px] text-[var(--beat-accent)]">
                  {m['services.llm.keySaved']()}
                </span>
              )}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
              }}
              placeholder={state?.hasApiKey ? '••••••••' : 'sk-...'}
              className="h-9 w-full rounded-[8px] border border-[var(--beat-border)] bg-[var(--beat-control)] px-2.5 text-[13px] text-[var(--beat-text-1)] outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] text-[var(--beat-text-2)]">
              {m['services.llm.model']()}
            </span>
            <input
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setSaved(false);
              }}
              placeholder="deepseek-chat"
              className="h-9 w-full rounded-[8px] border border-[var(--beat-border)] bg-[var(--beat-control)] px-2.5 text-[13px] text-[var(--beat-text-1)] outline-none"
            />
          </label>
        </div>
      </div>

      {state && !state.reachable && state.probeError && (
        <p className="mb-3 flex items-start gap-1.5 rounded-[8px] bg-[var(--beat-warn-text)]/10 px-3 py-2 text-[12.5px] text-[var(--beat-warn-text)]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {state.probeError}
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-[8px] bg-[var(--beat-warn-text)]/10 px-3 py-2 text-[12.5px] text-[var(--beat-warn-text)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving || !baseUrl.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--beat-accent)] px-4 text-[13px] font-medium text-[var(--beat-accent-ink)] disabled:opacity-40"
        >
          {saving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> {m['services.llm.saving']()}
            </>
          ) : saved ? (
            <>
              <Check className="size-3.5" /> {m['services.llm.saved']()}
            </>
          ) : (
            m['services.llm.save']()
          )}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--beat-border)] px-3 text-[13px] text-[var(--beat-text-2)] disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" /> {m['services.llm.recheck']()}
        </button>
        <span className="text-[12px] text-[var(--beat-text-3)]">
          {m['services.llm.hint']()}
        </span>
      </div>
    </section>
  );
}

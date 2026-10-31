import { useCallback, useEffect, useState } from 'react';

import type { ModulesApi } from '@/components/onboarding/module-deploy-panel';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';

/**
 * First-launch onboarding.
 *
 * A desktop build opens onto a machine that has nothing configured: no ComfyUI,
 * no models, no idea where the bundle lives. This page splits that into three
 * steps, each doable in place.
 *
 * Only active inside the desktop shell (window.mankeDesktop exists). Running the
 * workbench source in a browser skips it -- that user already knows the setup.
 */

/** Main process returns facts only; the wording comes from i18n by id. */
type Check = {
  id: string;
  ok: boolean;
  detail: string;
  hintId?: string | null;
};

type EnvState = {
  checks: Check[];
  ok: boolean;
  ready: boolean;
  comfyRoot: string | null;
  comfyFound: string[];
};

type DesktopApi = {
  isDesktop: true;
  info: () => Promise<{ version: string; dataDir: string; serverUrl: string; packaged: boolean }>;
  onboarding: {
    state: () => Promise<{ completed: boolean; completedAt: string | null }>;
    complete: () => Promise<{ ok: boolean }>;
  };
  env: { check: () => Promise<EnvState> };
  comfy: {
    status: () => Promise<{ running: boolean; root: string | null; roots: string[] }>;
    start: () => Promise<{ ok: boolean; message: string }>;
    stop: () => Promise<{ ok: boolean; message: string }>;
    pickRoot: () => Promise<{ ok: boolean; root?: string; message?: string }>;
  };
  bundle: {
    guess: () => Promise<BundleState>;
    inspect: (dir: string) => Promise<BundleState>;
    pickDir: () => Promise<BundleState & { canceled?: boolean }>;
    pickTarget: () => Promise<{ ok: boolean; dir?: string; canceled?: boolean }>;
    extract: (payload: { firstVolume: string; targetDir: string }) => Promise<{
      ok: boolean;
      targetDir: string;
      comfyRoot?: string | null;
      message: string;
    }>;
    deploy: (payload: { dir: string; targetDir: string }) => Promise<{
      ok: boolean;
      comfyRoot?: string | null;
      comfyStarted?: boolean;
      message: string;
    }>;
    freeSpace: (dir: string) => Promise<{ free: number | null }>;
    resumable: () => Promise<{
      phase: string;
      targetDir: string;
      percent: number;
      entries: number;
      error?: string | null;
    } | null>;
    resume: () => Promise<{
      ok: boolean;
      comfyRoot?: string | null;
      message: string;
    }>;
    discard: () => Promise<{ ok: boolean }>;
    state: () => Promise<{
      phase: string;
      percent: number;
      message: string;
      targetDir: string;
    } | null>;
    onProgress: (
      handler: (p: { phase?: string; percent: number; line?: string; message?: string }) => void
    ) => () => void;
  };
    modules: ModulesApi;
  openLogs: () => Promise<string>;
};

/** What bundle:inspect reports back about a folder of .7z volumes. */
type BundleState = {
  dir: string;
  ok: boolean;
  base?: string | null;
  volumes?: number;
  totalBytes?: number;
  firstVolume?: string | null;
  missing?: number[];
  message: string;
};

declare global {
  interface Window {
    mankeDesktop?: DesktopApi;
  }
}

type Step = 'welcome' | 'check' | 'ready';

const BONUS_LINK_URL = 'https://pan.quark.cn/s/8d1ed42563d4';
const BONUS_LINK_CODE = '~9d1f3bt6QP~:/';

const StepDot = ({ active, done }: { active: boolean; done: boolean }) => (
  <span
    className={[
      'inline-block size-2 rounded-full transition',
      done
        ? 'bg-[var(--beat-accent)]'
        : active
          ? 'bg-[var(--beat-accent)] opacity-100'
          : 'bg-[var(--beat-text-3)] opacity-30',
    ].join(' ')}
    aria-hidden="true"
  />
);

const CheckRow = ({ check, t }: { check: Check; t: (k: string) => string }) => (
  <li className="flex items-start gap-3 rounded-xl border border-[var(--beat-line)] bg-[var(--beat-surface)] px-4 py-3">
    <span
      className={[
        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white',
        check.ok ? 'bg-emerald-500' : 'bg-amber-500',
      ].join(' ')}
      aria-hidden="true"
    >
      {check.ok ? '✓' : '!'}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-[14px] font-medium text-[var(--beat-text-1)]">{t(`check.${check.id}`)}</p>
      <p className="mt-0.5 truncate text-[13px] text-[var(--beat-text-3)]" title={check.detail}>
        {check.detail}
      </p>
      {check.hintId ? (
        <p className="mt-1 text-[12px] text-amber-600">{t(`hint.${check.hintId}`)}</p>
      ) : null}
    </div>
  </li>
);

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Onboarding');
  // Check ids map to Onboarding.check.*, hints to Onboarding.hint.*
  const [phase, setPhase] = useState<'loading' | 'onboarding' | 'app'>('loading');
  const [step, setStep] = useState<Step>('welcome');
  const [env, setEnv] = useState<EnvState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bundle, setBundle] = useState<BundleState | null>(null);
  const [bundleTarget, setBundleTarget] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [percent, setPercent] = useState(0);
  const [progressNote, setProgressNote] = useState('');
  const [resumable, setResumable] = useState<{
    phase: string;
    targetDir: string;
    percent: number;
    entries: number;
    error?: string | null;
  } | null>(null);

  // Desktop shell only; a browser session goes straight through.
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.mankeDesktop;
    if (!api) {
      setPhase('app');
      return;
    }
    void api.onboarding.state().then((s) => {
      setPhase(s.completed ? 'app' : 'onboarding');
    });
  }, []);

  const runCheck = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.env.check();
      setEnv(result);
      // Also check whether the last deploy left a half-finished target.
      setResumable(await api.bundle.resumable());
    } finally {
      setBusy(false);
    }
  }, []);

  const handlePickRoot = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.comfy.pickRoot();
      if (result.ok) {
        setMessage(t('comfyPicked'));
        await runCheck();
      } else if (result.message) {
        setMessage(result.message);
      }
    } finally {
      setBusy(false);
    }
  }, [runCheck, t]);

  const handleStartComfy = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    setBusy(true);
    setMessage(t('comfyStarting'));
    try {
      const result = await api.comfy.start();
      setMessage(result.message);
      await runCheck();
    } finally {
      setBusy(false);
    }
  }, [runCheck, t]);

  // Bundle handling: inspect finds the volumes, extract runs 7z and writes the
  // resulting folder into the ComfyUI config so the next check goes green.
  const handleInspectBundle = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    setBusy(true);
    setMessage(null);
    try {
      const found = await api.bundle.guess();
      setBundle(found);
      if (!found.ok) {
        setMessage(found.message);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const handlePickBundleDir = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    setBusy(true);
    setMessage(null);
    try {
      const picked = await api.bundle.pickDir();
      if (picked.canceled) return;
      setBundle(picked);
      setMessage(picked.message);
    } finally {
      setBusy(false);
    }
  }, []);

  // One-button flow: inspect, size check, extract, write the config and start
  // ComfyUI. The user picks the volume folder and the target drive; everything
  // after that happens here so there is nothing else to click.
  const handleDeploy = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;

    // Volume folder: reuse a healthy check, otherwise ask.
    let dir = bundle?.dir ?? '';
    if (!bundle?.ok) {
      const picked = await api.bundle.pickDir();
      if (picked.canceled) return;
      setBundle(picked);
      dir = picked.dir ?? '';
      if (!picked.ok) {
        setMessage(picked.message);
        return;
      }
    }

    // Target drive.
    const target = await api.bundle.pickTarget();
    if (!target.ok || !target.dir) return;
    setBundleTarget(target.dir);

    setExtracting(true);
    setPercent(0);
    setProgressNote(t('deployStarting'));
    setMessage(null);

    const stop = api.bundle.onProgress((p) => {
      setPercent(p.percent ?? 0);
      const note = p.message ?? p.line ?? '';
      if (note) setProgressNote(note);
    });

    try {
      const result = await api.bundle.deploy({ dir, targetDir: target.dir });
      setMessage(result.message);
      if (result.ok) {
        await runCheck();
      }
    } finally {
      stop();
      setExtracting(false);
      setPercent(0);
      setProgressNote('');
    }
  }, [bundle, runCheck, t]);

  // An interrupted deploy leaves files on disk and a state file behind. Offer to
  // pick it up instead of making the user sit through another hour.
  const handleResume = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    setExtracting(true);
    setPercent(0);
    setProgressNote(t('resuming'));
    setMessage(null);

    const stop = api.bundle.onProgress((p) => {
      setPercent(p.percent ?? 0);
      const note = p.message ?? p.line ?? '';
      if (note) setProgressNote(note);
    });

    try {
      const result = await api.bundle.resume();
      setMessage(result.message);
      if (result.ok) {
        setResumable(null);
        await runCheck();
      }
    } finally {
      stop();
      setExtracting(false);
      setPercent(0);
      setProgressNote('');
    }
  }, [runCheck, t]);

  const handleDiscard = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    await api.bundle.discard();
    setResumable(null);
    setMessage(t('discarded'));
  }, [t]);

  const handleFinish = useCallback(async () => {
    const api = window.mankeDesktop;
    if (!api) return;
    setBusy(true);
    try {
      await api.onboarding.complete();
      setPhase('app');
    } finally {
      setBusy(false);
    }
  }, []);

  if (phase === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--beat-bg)]">
        <div className="size-6 animate-spin rounded-full border-2 border-[var(--beat-line)] border-t-[var(--beat-accent)]" />
      </div>
    );
  }

  if (phase === 'app') return <>{children}</>;

  return (
    <div className="min-h-screen bg-[var(--beat-bg)] px-6 py-10">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
        {/* Header: title and step dots */}
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium tracking-wide text-[var(--beat-text-3)]">
              {t('brand')}
            </p>
            <h1 className="mt-1 text-[26px] font-semibold text-[var(--beat-text-1)]">
              {step === 'welcome' && t('welcomeTitle')}
              {step === 'check' && t('checkTitle')}
              {step === 'ready' && t('readyTitle')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <StepDot active={step === 'welcome'} done={step !== 'welcome'} />
            <StepDot active={step === 'check'} done={step === 'ready'} />
            <StepDot active={step === 'ready'} done={false} />
          </div>
        </header>

        {/* Step 1: what this program does */}
        {step === 'welcome' ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] leading-7 text-[var(--beat-text-2)]">{t('welcomeBody')}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="beat-glass rounded-2xl p-5">
                <p className="text-[14px] font-semibold text-[var(--beat-text-1)]">
                  {t('welcomeBuiltinTitle')}
                </p>
                <p className="mt-1.5 text-[13px] leading-6 text-[var(--beat-text-3)]">
                  {t('welcomeBuiltinBody')}
                </p>
              </div>
              <div className="beat-glass rounded-2xl p-5">
                <p className="text-[14px] font-semibold text-[var(--beat-text-1)]">
                  {t('welcomeNeedTitle')}
                </p>
                <p className="mt-1.5 text-[13px] leading-6 text-[var(--beat-text-3)]">
                  {t('welcomeNeedBody')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setStep('check');
                  void runCheck();
                }}
                className="rounded-full bg-[var(--beat-accent)] px-6 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90"
              >
                {t('startCheck')}
              </button>
              <button
                type="button"
                onClick={() => void handleFinish()}
                className="rounded-full px-4 py-2.5 text-[14px] text-[var(--beat-text-3)] transition hover:text-[var(--beat-text-1)]"
              >
                {t('skip')}
              </button>
            </div>
          </div>
        ) : null}

        {/* Step 2: environment check */}
        {step === 'check' ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] leading-7 text-[var(--beat-text-2)]">{t('checkBody')}</p>

            {env ? (
              <ul className="flex flex-col gap-2">
                {env.checks.map((c) => (
                  <CheckRow key={c.id} check={c} t={t} />
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 py-6 text-[14px] text-[var(--beat-text-3)]">
                <span className="size-4 animate-spin rounded-full border-2 border-[var(--beat-line)] border-t-[var(--beat-accent)]" />
                {t('checking')}
              </div>
            )}

            {message ? (
              <p className="rounded-xl bg-[var(--beat-accent-soft)] px-4 py-3 text-[13px] leading-6 text-[var(--beat-accent-ink)]">
                {message}
              </p>
            ) : null}

            {/* ComfyUI setup. The outer card renders whenever the check has run --
                not only when ComfyUI is missing. A machine that already has one
                may still want a second copy or more models, and hiding the bundle
                panel behind "not found" made it unreachable where it worked. */}
            {env ? (
              <div className="beat-glass rounded-2xl p-5">
                {!env.checks.find((c) => c.id === 'comfyui')?.ok ? (
                  <p className="text-[14px] font-semibold text-[var(--beat-text-1)]">
                    {t('missingComfyTitle')}
                  </p>
                ) : (
                  <p className="text-[14px] font-semibold text-[var(--beat-text-1)]">
                    {t('bundleTitle')}
                  </p>
                )}
                <p className="mt-1.5 text-[13px] leading-6 text-[var(--beat-text-3)]">
                  {t('bundleBody')}
                </p>

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handlePickRoot()}
                    className="w-full rounded-xl border border-[var(--beat-line)] bg-[var(--beat-surface)] px-4 py-2.5 text-left text-[13px] font-medium text-[var(--beat-text-1)] transition hover:border-[var(--beat-accent)] disabled:opacity-50"
                  >
                    {t('pickRoot')}
                  </button>

                  <a
                    href={BONUS_LINK_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full rounded-xl border border-[var(--beat-line)] bg-[var(--beat-surface)] px-4 py-2.5 text-left text-[13px] transition hover:border-[var(--beat-accent)]"
                  >
                    <span className="font-medium text-[var(--beat-text-1)]">{t('downloadBundle')}</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--beat-text-3)]">
                      {t('downloadBundleHint')} {BONUS_LINK_CODE}
                    </span>
                  </a>

                  {/* Step two after downloading: check the volumes, then extract. */}
                  <div className="mt-1 rounded-xl border border-dashed border-[var(--beat-line)] p-3">
                    <p className="text-[12px] font-medium text-[var(--beat-text-2)]">
                      {t('bundleTitle')}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--beat-text-3)]">
                      {t('bundleBody')}
                    </p>

                    {bundle ? (
                      <div className="mt-2 rounded-lg bg-[var(--beat-surface)] px-3 py-2">
                        <p className="truncate text-[11px] text-[var(--beat-text-3)]" title={bundle.dir}>
                          {bundle.dir || t('bundleNoDir')}
                        </p>
                        <p
                          className={
                            bundle.ok
                              ? 'mt-0.5 text-[12px] font-medium text-emerald-600'
                              : 'mt-0.5 text-[12px] font-medium text-amber-600'
                          }
                        >
                          {bundle.message}
                        </p>
                        {bundle.base ? (
                          <p className="mt-0.5 text-[11px] text-[var(--beat-text-3)]">
                            {bundle.base}.001 · {bundle.volumes} {t('bundleVolumes')} ·{' '}
                            {((bundle.totalBytes ?? 0) / 1024 ** 3).toFixed(1)} GB
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {extracting ? (
                      <div className="mt-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--beat-line)]">
                          <div
                            className="h-full rounded-full bg-[var(--beat-accent)] transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <p className="mt-1 truncate text-[11px] text-[var(--beat-text-3)]" title={progressNote}>
                          {percent}% · {progressNote}
                          {bundleTarget ? ` → ${bundleTarget}` : ''}
                        </p>
                      </div>
                    ) : null}

                    {/* A previous run died mid-extract. The files are still on
                        disk and -aos will skip them, so resuming costs minutes
                        instead of the full hour. */}
                    {resumable ? (
                      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                        <p className="text-[12px] font-medium text-amber-800">
                          {t('resumeTitle')}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-amber-700" title={resumable.targetDir}>
                          {t('resumeBody')} {resumable.percent}% · {resumable.targetDir}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy || extracting}
                            onClick={() => void handleResume()}
                            className="rounded-full bg-amber-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                          >
                            {t('resumeButton')}
                          </button>
                          <button
                            type="button"
                            disabled={busy || extracting}
                            onClick={() => void handleDiscard()}
                            className="rounded-full px-3 py-1.5 text-[11px] text-amber-700 transition hover:text-amber-900 disabled:opacity-50"
                          >
                            {t('resumeDiscard')}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* One button. Picking the folder and the target drive are the
                        only two decisions; inspect, extract, config and start all
                        happen behind it. */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || extracting}
                        onClick={() => void handleDeploy()}
                        className="rounded-full bg-[var(--beat-accent)] px-4 py-2 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                      >
                        {extracting ? t('deployRunning') : t('deployOneClick')}
                      </button>
                      <button
                        type="button"
                        disabled={busy || extracting}
                        onClick={() => void handleInspectBundle()}
                        className="rounded-full border border-[var(--beat-line)] px-3 py-1.5 text-[11px] text-[var(--beat-text-2)] transition hover:border-[var(--beat-accent)] disabled:opacity-50"
                      >
                        {t('bundleInspect')}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep('ready')}
                    className="w-full rounded-xl px-4 py-2.5 text-left text-[13px] text-[var(--beat-text-3)] transition hover:text-[var(--beat-text-1)]"
                  >
                    {t('later')}
                  </button>
                </div>
              </div>
            ) : null}

            {/* ComfyUI found but not running */}
            {env && env.checks.find((c) => c.id === 'comfyui')?.ok && !env.checks.find((c) => c.id === 'comfyui-running')?.ok ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleStartComfy()}
                className="self-start rounded-full bg-[var(--beat-accent)] px-6 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {t('startComfy')}
              </button>
            ) : null}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('ready')}
                className="rounded-full bg-[var(--beat-accent)] px-6 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90"
              >
                {t('next')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runCheck()}
                className="rounded-full px-4 py-2.5 text-[14px] text-[var(--beat-text-3)] transition hover:text-[var(--beat-text-1)] disabled:opacity-50"
              >
                {t('recheck')}
              </button>
            </div>
          </div>
        ) : null}

        {/* Step 3: wrap up */}
        {step === 'ready' ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] leading-7 text-[var(--beat-text-2)]">{t('readyBody')}</p>

            <div className="beat-glass rounded-2xl p-5">
              <p className="text-[13px] leading-6 text-[var(--beat-text-3)]">{t('readyNote')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={BONUS_LINK_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[var(--beat-line)] px-4 py-1.5 text-[12px] text-[var(--beat-text-2)] transition hover:border-[var(--beat-accent)]"
                >
                  {t('bundleLink')}
                </a>
                <button
                  type="button"
                  onClick={() => void window.mankeDesktop?.openLogs()}
                  className="rounded-full border border-[var(--beat-line)] px-4 py-1.5 text-[12px] text-[var(--beat-text-2)] transition hover:border-[var(--beat-accent)]"
                >
                  {t('openLogs')}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleFinish()}
                className="rounded-full bg-[var(--beat-accent)] px-6 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {t('enter')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('check');
                  void runCheck();
                }}
                className="rounded-full px-4 py-2.5 text-[14px] text-[var(--beat-text-3)] transition hover:text-[var(--beat-text-1)]"
              >
                {t('back')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
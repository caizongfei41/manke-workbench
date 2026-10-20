import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { cn } from '@/lib/utils';

export type AiExpandLanguage = 'zh' | 'en';
export type AiExpandMediaType = 'image' | 'video';

/**
 * Reusable "AI expand" control: an output-language switch (Chinese/English,
 * image only) plus the expand button. Video prompts (MiniMax H3 local
 * weights) are always English because the official 6-part format must be
 * English, so the language switch is hidden for video.
 */
export function AiExpandControl({
  prompt,
  mediaType,
  isBusy,
  onExpanded,
  className,
}: {
  prompt: string;
  mediaType: AiExpandMediaType;
  isBusy?: boolean;
  onExpanded: (text: string) => void;
  className?: string;
}) {
  const t = useTranslations('AppShell.studio.analysis');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [language, setLanguage] = useState<AiExpandLanguage>('en');

  const canExpand = prompt.trim().length > 0 && !isEnhancing && !isBusy;

  const handleExpand = async () => {
    const current = prompt.trim();
    if (!current || isEnhancing || isBusy) return;
    setIsEnhancing(true);
    try {
      const res = await fetch('/api/llm-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: current,
          mediaType,
          // H3 local weights require the English structured format.
          language: mediaType === 'video' ? 'en' : language,
        }),
      });
      const data = (await res.json()) as { expanded?: string; error?: string };
      if (!res.ok || !data.expanded) {
        window.alert(t('enhanceError'));
        return;
      }
      onExpanded(data.expanded);
    } catch {
      window.alert(t('enhanceError'));
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {mediaType === 'image' ? (
        <div className="flex items-center rounded-full border border-ink/[0.1] bg-ink/[0.04] p-0.5 text-[13px] leading-none">
          <button
            type="button"
            onClick={() => setLanguage('zh')}
            className={cn(
              'rounded-full px-1.5 py-1 transition',
              language === 'zh'
                ? 'bg-[var(--beat-accent)]/20 text-white'
                : 'text-[var(--beat-text-2)] hover:text-ink'
            )}
          >
            {t('aiExpandZh')}
          </button>
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={cn(
              'rounded-full px-1.5 py-1 transition',
              language === 'en'
                ? 'bg-[var(--beat-accent)]/20 text-white'
                : 'text-[var(--beat-text-2)] hover:text-ink'
            )}
          >
            {t('aiExpandEn')}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={handleExpand}
        disabled={!canExpand}
        className="flex items-center gap-1 rounded-full border border-ink/[0.1] bg-ink/[0.04] px-2 py-0.5 text-[13px] text-[var(--beat-text-2)] transition hover:bg-ink/[0.08] disabled:opacity-40"
      >
        {isEnhancing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        {isEnhancing ? t('aiExpanding') : t('aiExpand')}
      </button>
    </div>
  );
}

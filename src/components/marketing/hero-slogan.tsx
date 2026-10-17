import { useEffect, useState } from 'react';

import { normalizeLocale } from '@/config/locale';
import { m } from '@/paraglide/messages.js';

/**
 * Hero slogan rotator.
 *
 * Two lines alternate on a timer. The element is keyed by index so React mounts a
 * fresh node each time, which lets a CSS fade play without tracking transition
 * state here. Reduced-motion users get the same rotation without the animation.
 */
export function HeroSlogan({ locale }: { locale: string }) {
  const messageLocale = normalizeLocale(locale);
  const slogans = [
    m['product.home.slogan1']({}, { locale: messageLocale }),
    m['product.home.slogan2']({}, { locale: messageLocale }),
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slogans.length);
    }, 4600);
    return () => window.clearInterval(timer);
  }, [slogans.length]);

  return (
    <h1 className="beat-product-display beat-product-hero-title mx-auto mt-6 w-full max-w-[960px] text-[clamp(1.5rem,3.1vw,2.5rem)] font-semibold leading-[1.24] tracking-[-0.02em] text-[var(--beat-text-1)]">
      <span key={index} className="beat-slogan-swap block">
        {slogans[index]}
      </span>
    </h1>
  );
}

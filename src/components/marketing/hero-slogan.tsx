import { useEffect, useState } from 'react';

import { normalizeLocale } from '@/config/locale';
import { m } from '@/paraglide/messages.js';

/**
 * Hero slogan rotator.
 *
 * Three lines take turns: the brand, then what you make, then what it means.
 * Each has to stay on one line, so the size is capped by the longest line rather
 * than fitted per slogan — otherwise the text would change size on every swap.
 * `whitespace-nowrap` plus a viewport-scaled clamp is what keeps that honest.
 *
 * The element is keyed by index so React mounts a fresh node each time, which
 * lets a CSS fade play without tracking transition state here. Reduced-motion
 * users get the same rotation, just slower and without the animation.
 */
export function HeroSlogan({ locale }: { locale: string }) {
  const messageLocale = normalizeLocale(locale);
  const slogans = [
    m['product.home.slogan1']({}, { locale: messageLocale }),
    m['product.home.slogan2']({}, { locale: messageLocale }),
    m['product.home.slogan3']({}, { locale: messageLocale }),
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % slogans.length),
      reduced ? 6000 : 4200
    );
    return () => window.clearInterval(timer);
  }, [slogans.length]);

  return (
    <h1 className="beat-product-display beat-product-hero-title mx-auto mt-6 flex min-h-[1.2em] w-full max-w-[1120px] items-center justify-center font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--beat-text-1)]">
      <span key={index} className="beat-slogan-swap block whitespace-nowrap text-center">
        {slogans[index]}
      </span>
    </h1>
  );
}

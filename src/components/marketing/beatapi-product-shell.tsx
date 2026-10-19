import {
  Menu,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { LanguageSwitcher } from '@/components/app/language-switcher';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { normalizeLocale } from '@/config/locale';
import { Link } from '@/core/i18n/navigation';
import { appConfig } from '@/config';
import { m } from '@/paraglide/messages.js';

type ProductSurface = 'home' | 'projects' | 'assets';

function getShellCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    home: m['product.shell.home']({}, { locale: messageLocale }),
    create: m['product.shell.create']({}, { locale: messageLocale }),
    projects: m['product.shell.projects']({}, { locale: messageLocale }),
    assets: m['product.shell.assets']({}, { locale: messageLocale }),
    openNavigation: m['product.shell.openNavigation'](
      {},
      { locale: messageLocale }
    ),
    closeNavigation: m['product.shell.closeNavigation'](
      {},
      { locale: messageLocale }
    ),
    switchLanguage: m['product.shell.switchLanguage'](
      {},
      { locale: messageLocale }
    ),
    tagline: m['product.shell.tagline']({}, { locale: messageLocale }),
    footerWorkspaces: m['product.shell.footerWorkspaces']({}, { locale: messageLocale }),
    footerRuntime: m['product.shell.footerRuntime']({}, { locale: messageLocale }),
    footerLocal: m['product.shell.footerLocal']({}, { locale: messageLocale }),
    footerNoAccount: m['product.shell.footerNoAccount']({}, { locale: messageLocale }),
    footerGpu: m['product.shell.footerGpu']({}, { locale: messageLocale }),
    terms: m['product.shell.terms']({}, { locale: messageLocale }),
    privacy: m['product.shell.privacy']({}, { locale: messageLocale }),
  };
}

type ShellCopy = ReturnType<typeof getShellCopy>;

function getNavItems(copy: ShellCopy) {
  return [
    { label: copy.home, href: '/' },
    { label: copy.create, href: '/studio' },
    { label: copy.projects, href: '/projects' },
    { label: copy.assets, href: '/assets' },
  ] as const;
}

const activeNavHref: Record<ProductSurface, string> = {
  home: '/',
  projects: '/projects',
  assets: '/assets',
};

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label={`${appConfig.app_name} home`}
      className="beat-product-display inline-flex min-w-0 items-center gap-2.5 text-[15px] font-semibold tracking-[-0.02em] text-[var(--beat-text-1)] sm:text-base"
    >
      <img
        src={appConfig.app_logo}
        alt=""
        className="size-7 shrink-0 rounded-[9px] object-contain"
      />
      <span className="truncate">{appConfig.app_name}</span>
    </Link>
  );
}

function CapsuleNav({
  active,
  items,
}: {
  active: ProductSurface;
  items: ReturnType<typeof getNavItems>;
}) {
  const activeHref = activeNavHref[active];
  return (
    <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-5 text-sm font-medium md:flex lg:gap-8">
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              isActive
                ? 'text-ink'
                : 'text-ink/45 transition-colors hover:text-ink'
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BeatApiProductShell({
  active,
  locale,
  children,
}: {
  active: ProductSurface;
  locale: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const currentLocale = normalizeLocale(locale);
  const copy = getShellCopy(currentLocale);
  const navItems = getNavItems(copy);

  return (
    <div
      lang={currentLocale}
      className="beat-product-shell min-h-[100dvh] bg-[var(--beat-bg)] pt-4 text-[var(--beat-text-1)] selection:bg-[var(--beat-accent)]/35 sm:pt-5"
    >
      <header className="sticky top-3 z-40 px-4 sm:top-4 sm:px-6">
        <div className="beat-glass mx-auto flex h-[60px] w-full min-w-0 max-w-[1280px] items-center gap-3 rounded-full px-3 text-[var(--beat-text-1)] sm:px-4">
          <Brand />

          <CapsuleNav active={active} items={navItems} />

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block">
              <LanguageSwitcher />
            </div>
            <div className="hidden md:block">
              <ThemeToggle />
            </div>

            <button
              type="button"
              aria-label={
                menuOpen ? copy.closeNavigation : copy.openNavigation
              }
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid size-10 place-items-center rounded-full border border-ink/10 bg-ink/[0.035] text-ink transition hover:border-ink/20 md:hidden"
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="absolute inset-x-4 top-[calc(100%+8px)] rounded-[18px] border border-ink/10 bg-[var(--beat-surface)]/95 p-2 shadow-2xl backdrop-blur-xl md:hidden">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-[12px] px-4 py-3 text-sm font-medium text-[var(--beat-text-1)] hover:bg-ink/[0.06] hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-ink/10 px-2 pt-3">
              <span className="text-[11px] font-medium text-[var(--beat-text-3)]">
                {copy.switchLanguage}
              </span>
              <LanguageSwitcher />
            </div>
          </div>
        ) : null}
      </header>

      {children}

      <footer className="mt-24 border-t border-ink/[0.07] px-5 pb-10 pt-14 sm:px-6" data-site-footer="true">
        <div className="mx-auto grid w-full max-w-[1280px] gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <span className="inline-flex items-center gap-2.5 text-[14px] font-semibold text-[var(--beat-text-1)]">
              <img src={appConfig.app_logo} alt="" className="size-6 shrink-0 rounded-[7px] object-contain" />
              {appConfig.app_name}
            </span>
            <p className="mt-3 max-w-xs text-[12px] leading-6 text-[var(--beat-text-2)]">{copy.tagline}</p>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.14em] text-[var(--beat-text-3)]">
              {copy.footerWorkspaces}
            </h3>
            <ul className="mt-3 space-y-2">
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-[12px] text-[var(--beat-text-2)] transition hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.14em] text-[var(--beat-text-3)]">
              {copy.footerRuntime}
            </h3>
            <ul className="mt-3 space-y-2 text-[12px] text-[var(--beat-text-2)]">
              <li>{copy.footerLocal}</li>
              <li>{copy.footerNoAccount}</li>
              <li>{copy.footerGpu}</li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-10 flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 border-t border-ink/[0.07] pt-5 text-[11px] text-[var(--beat-text-3)]">
          <span>{appConfig.app_name} · {copy.tagline}</span>
          <span className="flex items-center gap-3">
            <span>{copy.terms}</span>
            <span aria-hidden="true">·</span>
            <span>{copy.privacy}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Container } from '@/components/container';
import { LogoMark } from '@/components/logo-mark';
import { Link } from '@/lib/i18n/navigation';

import { SiteHeaderFrame } from './site-header-frame';
import { ThemeToggle } from './theme-toggle';

/**
 * The glass bar on top of the site pages: the brand and the `search` on the
 * left, the theme toggle (from `md`; the footer has it below that) and the
 * `account` on the right. Both slots are filled by the layout, since shared
 * components don't reach into features.
 */
export function SiteHeader({
  search,
  account,
}: {
  search: ReactNode;
  account: ReactNode;
}) {
  const t = useTranslations('header');

  return (
    <>
      <a
        href="#main"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground text-sm outline-none focus-visible:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t('skipToContent')}
      </a>
      <SiteHeaderFrame>
        <Container>
          <div className="glass relative flex items-center gap-2 rounded-full p-1.5 pl-3 md:gap-3 md:pl-4">
            <Link
              href="/"
              aria-label={t('home')}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-1 py-1 outline-none transition-opacity duration-150 ease-out hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <LogoMark className="size-7 md:size-5.5" />
              <span className="font-bold text-lg tracking-tight">
                {t('wordmark')}
              </span>
            </Link>
            <div className="flex flex-1 items-center gap-1.5 md:gap-3">
              {search}
              <div className="flex items-center gap-1.5 md:ml-auto">
                <div className="hidden md:block">
                  <ThemeToggle />
                </div>
                {account}
              </div>
            </div>
          </div>
        </Container>
      </SiteHeaderFrame>
    </>
  );
}

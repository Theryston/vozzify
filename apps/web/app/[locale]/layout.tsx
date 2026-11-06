import { GoogleTagManager } from '@next/third-parties/google';
import type { Metadata } from 'next';
import { Figtree, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';

import '../globals.css';
import { Providers } from '@/components/providers';
import { AcquisitionAttributor } from '@/features/auth/components/acquisition-attributor';
import { AuthGate } from '@/features/auth/components/auth-gate';
import { NotefinderAnnouncement } from '@/features/notefinder/components/notefinder-announcement';
import { getSiteUrl } from '@/lib/env/client';
import { routing } from '@/lib/i18n/routing';
import { cn } from '@/lib/utils';

// `optional`: the fonts are preloaded, so they are almost always there for
// the first paint; when they aren't, the page keeps the fallback instead of
// swapping later. A swap reflows text, and on centered layouts (auth pages)
// that moves everything and eats the CLS budget (lighthouserc.cjs). The
// fallback is metric-adjusted to Arial, which not every system has.
const fontSans = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'optional',
});

const fontMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'optional',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');

  return {
    // Resolves the relative canonical/hreflang URLs pages set with
    // `localeAlternates` into absolute ones, as search engines require.
    metadataBase: getSiteUrl(),
    title: { default: t('title'), template: t('titleTemplate') },
    description: t('description'),
  };
}

export default async function LocaleLayout({
  children,
}: LayoutProps<'/[locale]'>) {
  // Resolved from `next/root-params` in lib/i18n/request.ts, which also
  // rejects unknown locales with notFound().
  const locale = await getLocale();
  const { errors, notefinderNotice } = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(
        'antialiased',
        fontSans.variable,
        fontMono.variable,
        'font-sans',
      )}
    >
      <body>
        <GoogleTagManager gtmId="GTM-PD2H3WNN" />
        {/* Only the namespaces client components need, to keep the RSC
            payload small. */}
        <NextIntlClientProvider messages={{ errors, notefinderNotice }}>
          <Providers>
            <AuthGate />
            <AcquisitionAttributor />
            <NotefinderAnnouncement />
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

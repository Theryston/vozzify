import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Suspense } from 'react';

import { Container } from '@/components/container';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { AccountMenu } from '@/features/auth/components/account-menu';
import { HeaderSearch } from '@/features/search/components/header-search';
import { HeaderSearchFallback } from '@/features/search/components/header-search-bar';

/** Site pages (home, tracks, search, terms…): everything but auth. */
export default async function SiteLayout({
  children,
}: LayoutProps<'/[locale]'>) {
  const { errors, header, privateTracks } = await getMessages();
  const {
    title,
    loading,
    loadError,
    close,
    proLabel,
    proTitle,
    proDescription,
    proNotes,
    proVocals,
    proPitch,
    viewPlans,
  } = privateTracks;

  return (
    // The header's client components need its messages; only site pages
    // pay for them.
    <NextIntlClientProvider
      messages={{
        errors,
        header,
        privateTracks: {
          title,
          loading,
          loadError,
          close,
          proLabel,
          proTitle,
          proDescription,
          proNotes,
          proVocals,
          proPitch,
          viewPlans,
        },
      }}
    >
      <SiteHeader
        search={
          <Suspense fallback={<HeaderSearchFallback />}>
            <HeaderSearch />
          </Suspense>
        }
        account={<AccountMenu />}
      />
      <main
        id="main"
        tabIndex={-1}
        className="min-h-[calc(100vh-12rem)] pt-4 outline-none md:pt-6"
      >
        <Container className="flex flex-col gap-2 md:gap-3">
          {children}
        </Container>
      </main>
      <SiteFooter />
    </NextIntlClientProvider>
  );
}

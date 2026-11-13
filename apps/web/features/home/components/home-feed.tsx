import type { HomeFeedPage } from '@vozzify/contracts';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { getAdsenseConfig } from '@/lib/env/adsense';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { getPublicHomePage, getSessionHomePage } from '../home-queries';
import { hasSessionCookie } from '../session-cookie';
import { HomeRows } from './home-rows';

/**
 * The home's rows, server-rendered. A visitor without a session gets the
 * locale's shared, cached feed; a signed-in one gets a request-time answer.
 * A failed API read shows no rows rather than failing the page, since the
 * home is a bonus over the page's own content.
 */
export async function HomeFeed() {
  const locale = await getLocale();
  if (!isLocale(locale)) return null;
  const page = await loadFirstPage(locale).catch(() => undefined);
  if (!page) return null;
  return (
    // The rows' client components need the home and track-card strings only;
    // the rest of the messages stay on the server.
    <NextIntlClientProvider messages={await rowMessages()}>
      <HomeRows
        locale={locale}
        initialPage={page}
        advertising={getAdsenseConfig()}
      />
    </NextIntlClientProvider>
  );
}

async function loadFirstPage(locale: Locale): Promise<HomeFeedPage> {
  const names = (await cookies()).getAll().map(({ name }) => name);
  return hasSessionCookie(names)
    ? getSessionHomePage(locale)
    : getPublicHomePage(locale);
}

async function rowMessages() {
  const { advertising, home, tracks } = await getMessages();
  return { advertising, home, tracks: { card: tracks.card } };
}

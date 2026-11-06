import 'server-only';

import { cacheTags, type HomeFeedPage, type Locale } from '@vozzify/contracts';
import { cacheLife, cacheTag } from 'next/cache';

import { serverApi } from '@/lib/api/server';

import { acceptPublicFeed, publicHomeRequest } from './public-feed';

/**
 * The first page of the public feed of one locale, shared by every visitor
 * without a session. Cached under the locale's tag, which the API revalidates
 * only when that feed's content changed, so the lifetime is a backstop.
 */
export async function getPublicHomePage(locale: Locale): Promise<HomeFeedPage> {
  'use cache';
  cacheTag(cacheTags.home(locale));
  cacheLife({ stale: 60, revalidate: 300, expire: 600 });
  return acceptPublicFeed(await serverApi('/home', publicHomeRequest(locale)));
}

/**
 * The first page for a signed-in visitor: the request's cookies are forwarded
 * and the answer is never cached on the web. Call it inside `<Suspense>`.
 */
export function getSessionHomePage(locale: Locale): Promise<HomeFeedPage> {
  return serverApi('/home', {
    ...publicHomeRequest(locale),
    forwardCookies: true,
  });
}

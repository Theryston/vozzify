import { clickIdSchema } from '@vozzify/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import {
  entityRedirectUrl,
  fetchCatalogRouteVerdict,
  parseCatalogRoute,
} from '@/lib/entity-route';
import { getServerEnv } from '@/lib/env/server';
import { consumeClickId } from '@/lib/home-click-id';
import { detectLocale } from '@/lib/i18n/detect-locale';
import { isLocale, localeCookieName } from '@/lib/i18n/routing';
import {
  fetchUserProfileVerdict,
  needsLowercaseRedirect,
  parseUserProfileRoute,
  userProfileRedirectUrl,
} from '@/lib/user-profile-route';

/**
 * Guards `/<locale>/artists/<id>`, `/<locale>/albums/<id>` and
 * `/<locale>/tracks/<id>`: a legacy ID permanently redirects (308) to the new
 * ID with the query kept, an unknown ID is a real 404. The check has to run
 * here, before anything streams: with Cache Components every dynamic route
 * streams a static shell first, so a redirect/`notFound` issued from the page
 * degrades to a 200 (meta refresh / in-place UI) and crawlers and legacy
 * bookmarks never see the real status.
 *
 * Fail-open on purpose: anything unexpected (no API configured, timeout, a
 * 500, an unparsable body) lets the request through, and the page renders
 * its own outcome (header, translated missing UI, error UI) instead of a
 * wrong redirect or 404.
 */
async function checkCatalogRoute(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  const route = parseCatalogRoute(request.nextUrl.pathname);
  if (!route) return undefined;
  let apiUrl: string;
  try {
    apiUrl = getServerEnv().API_URL;
  } catch {
    return undefined;
  }
  const verdict = await fetchCatalogRouteVerdict(apiUrl, route);
  if (verdict.kind === 'moved') {
    return NextResponse.redirect(
      entityRedirectUrl(request.nextUrl.href, route, verdict.newId),
      308,
    );
  }
  if (verdict.kind === 'missing') {
    const clickId = clickIdSchema.safeParse(
      request.nextUrl.searchParams.get('clickId'),
    );
    if (route.collection === 'tracks' && clickId.success) {
      const { cleanHref } = consumeClickId(request.nextUrl.href);
      const response = NextResponse.redirect(
        new URL(cleanHref, request.url),
        307,
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    // The localized catch-all keeps the site layout; /_not-found bypasses it.
    return NextResponse.rewrite(
      new URL(`/${route.locale}/not-found`, request.url),
      { status: 404 },
    );
  }
  return undefined;
}

/**
 * Guards `/<locale>/users/<username>`: a mixed-case username permanently
 * redirects (308) to its lowercase form, and an unknown username is a real
 * 404, decided here for the same reason as the catalog routes above.
 */
async function checkUserProfileRoute(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  const route = parseUserProfileRoute(request.nextUrl.pathname);
  if (!route) return undefined;
  if (needsLowercaseRedirect(route.username)) {
    return NextResponse.redirect(
      userProfileRedirectUrl(request.nextUrl.href, route.username),
      308,
    );
  }
  let apiUrl: string;
  try {
    apiUrl = getServerEnv().API_URL;
  } catch {
    return undefined;
  }
  const verdict = await fetchUserProfileVerdict(apiUrl, route.username);
  if (verdict.kind === 'missing') {
    return NextResponse.rewrite(
      new URL(`/${route.locale}/not-found`, request.url),
      { status: 404 },
    );
  }
  return undefined;
}

/**
 * Redirects every path without a locale prefix (including legacy URLs like
 * `/tracks/abc?x=1`) to the visitor's locale, keeping path and query.
 *
 * next-intl's middleware is deliberately not used: it has no country-based
 * detection, and on prefixed paths it may set the locale cookie, which would
 * make otherwise static pages uncacheable by the CDN and overwrite the
 * user's explicit choice with whatever link they last followed.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split('/')[1];

  // A URL that already has a locale is always respected.
  if (isLocale(firstSegment)) {
    // Catalog IDs need a verdict before anything streams (see above).
    return (
      (await checkCatalogRoute(request)) ??
      (await checkUserProfileRoute(request)) ??
      NextResponse.next()
    );
  }

  const locale = detectLocale({
    cookie: request.cookies.get(localeCookieName)?.value,
    country: request.headers.get('cf-ipcountry'),
    acceptLanguage: request.headers.get('accept-language'),
  });

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;

  // The target depends on the visitor, so it's a temporary redirect that no
  // shared cache (CDN) may store.
  const response = NextResponse.redirect(url, 307);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie, CF-IPCountry, Accept-Language');
  return response;
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals, root metadata files and
    // requests for static assets (by extension, so legacy paths with dots in
    // IDs or usernames still get redirected).
    '/((?!api(?:/|$)|_next/|_vercel/|favicon\\.ico$|sitemap\\.xml$|robots\\.txt$|.*\\.(?:ico|png|jpe?g|gif|webp|avif|svg|css|js|map|txt|xml|json|webmanifest|woff2?|ttf|otf|mp3|mp4|webm|onnx|wasm)$).*)',
  ],
};

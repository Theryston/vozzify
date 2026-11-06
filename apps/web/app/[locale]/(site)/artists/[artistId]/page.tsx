import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { StructuredData } from '@/components/structured-data';
import { ArtistHeader } from '@/features/artists/components/artist-header';
import { ArtistTracksSection } from '@/features/artists/components/artist-tracks-section';
import {
  getArtistResult,
  getArtistTracksPage,
} from '@/features/artists/queries';
import { getSiteUrl } from '@/lib/env/client';
import { localeAlternates } from '@/lib/i18n/metadata';
import type { Locale } from '@/lib/i18n/routing';
import { queryStringOf } from '@/lib/query-string';
import { artistStructuredData } from '@/lib/seo/catalog-structured-data';
import { socialMetadata } from '@/lib/seo/social-metadata';

type ArtistRouteParams = { locale: Locale; artistId: string };

type ArtistRouteSearchParams = Record<string, string | string[] | undefined>;

// The header, the 308 and the 404 all depend on the requested ID (and the
// redirect keeps its query), so this route never prerenders statically:
// the proxy decides 308s and 404s before anything streams (a redirect or
// `notFound` issued from postponed page content would degrade to a 200),
// and the page repeats the same outcome handling as a fallback. Data still
// caches through `getArtistResult`, so repeat visits stay instant; the
// skeleton below covers the header while it streams.
export const instant = false;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<ArtistRouteParams>;
  searchParams: Promise<ArtistRouteSearchParams>;
}): Promise<Metadata> {
  const { locale, artistId } = await params;
  const result = await getArtistResult(artistId);
  if (result.status !== 'found') {
    // No metadata of their own; the proxy normally answers moved/missing
    // before the page renders (see above), this is only its fallback.
    if (result.status === 'moved') {
      permanentRedirect(
        `/${locale}/artists/${result.newId}${queryStringOf(await searchParams)}`,
      );
    }
    notFound();
  }
  const t = await getTranslations('artists');
  const title = t('metaTitle', { name: result.artist.name });
  const description = t('metaDescription', { name: result.artist.name });
  return {
    title,
    description,
    alternates: localeAlternates(locale, `/artists/${result.artist.id}`),
    ...socialMetadata({
      locale,
      path: `/artists/${result.artist.id}`,
      title,
      description,
    }),
  };
}

/**
 * Thin artist route: reads the ID, fetches the cached header outcome and
 * its first tracks page, then renders both. A legacy ID permanently
 * redirects (308) to the new ID with the query kept; an unknown ID is a
 * real 404. Both are normally decided by the proxy before this renders
 * (see above); the checks below are its fallback.
 */
export default async function ArtistRoutePage({
  params,
  searchParams,
}: {
  params: Promise<ArtistRouteParams>;
  searchParams: Promise<ArtistRouteSearchParams>;
}) {
  const { locale, artistId } = await params;
  const query = await searchParams;
  const result = await getArtistResult(artistId);
  if (result.status === 'moved') {
    permanentRedirect(
      `/${locale}/artists/${result.newId}${queryStringOf(query)}`,
    );
  }
  if (result.status === 'missing') {
    notFound();
  }
  // The grid brings its own loading/error/empty UI through the client
  // query below, so a tracks failure must not take the header with it:
  // fall back to a client-side fetch instead of rejecting the whole page.
  const initialPage = await getArtistTracksPage(result.artist.id).catch(
    () => undefined,
  );
  return (
    <div className="flex flex-col gap-8">
      <StructuredData
        data={artistStructuredData({
          artist: result.artist,
          locale,
          siteUrl: getSiteUrl(),
        })}
      />
      <ArtistHeader artist={result.artist} />
      <ArtistTracksSection
        artistId={result.artist.id}
        initialPage={initialPage}
      />
    </div>
  );
}

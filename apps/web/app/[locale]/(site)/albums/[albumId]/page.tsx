import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { StructuredData } from '@/components/structured-data';
import { AlbumHeader } from '@/features/albums/components/album-header';
import { AlbumTracksSection } from '@/features/albums/components/album-tracks-section';
import { getAlbumResult, getAlbumTracksPage } from '@/features/albums/queries';
import { getSiteUrl } from '@/lib/env/client';
import { localeAlternates } from '@/lib/i18n/metadata';
import type { Locale } from '@/lib/i18n/routing';
import { queryStringOf } from '@/lib/query-string';
import { albumStructuredData } from '@/lib/seo/catalog-structured-data';
import { socialMetadata } from '@/lib/seo/social-metadata';

type AlbumRouteParams = { locale: Locale; albumId: string };

type AlbumRouteSearchParams = Record<string, string | string[] | undefined>;

// The header, the 308 and the 404 all depend on the requested ID (and the
// redirect keeps its query), so this route never prerenders statically:
// the proxy decides 308s and 404s before anything streams (a redirect or
// `notFound` issued from postponed page content would degrade to a 200),
// and the page repeats the same outcome handling as a fallback. Data still
// caches through `getAlbumResult`, so repeat visits stay instant; the
// skeleton covers the header while it streams.
export const instant = false;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<AlbumRouteParams>;
  searchParams: Promise<AlbumRouteSearchParams>;
}): Promise<Metadata> {
  const { locale, albumId } = await params;
  const result = await getAlbumResult(albumId);
  if (result.status !== 'found') {
    // No metadata of their own; the proxy normally answers moved/missing
    // before the page renders (see above), this is only its fallback.
    if (result.status === 'moved') {
      permanentRedirect(
        `/${locale}/albums/${result.newId}${queryStringOf(await searchParams)}`,
      );
    }
    notFound();
  }
  const t = await getTranslations('albums');
  const artists = result.album.artists
    .map((artist) => artist.name)
    .join(t('header.artistSeparator'));
  const values = { title: result.album.title, artists };
  const title = t(artists ? 'metaTitle' : 'metaTitleNoArtists', values);
  const description = t(
    artists ? 'metaDescription' : 'metaDescriptionNoArtists',
    values,
  );
  return {
    title,
    description,
    alternates: localeAlternates(locale, `/albums/${result.album.id}`),
    ...socialMetadata({
      locale,
      path: `/albums/${result.album.id}`,
      title,
      description,
      image: result.album.coverArtUrl,
    }),
  };
}

/**
 * Thin album route: reads the ID, fetches the cached header outcome and
 * its first tracks page, then renders both. A legacy ID permanently
 * redirects (308) to the new ID with the query kept; an unknown ID is a
 * real 404. Both are normally decided by the proxy before this renders
 * (see above); the checks below are its fallback.
 */
export default async function AlbumRoutePage({
  params,
  searchParams,
}: {
  params: Promise<AlbumRouteParams>;
  searchParams: Promise<AlbumRouteSearchParams>;
}) {
  const { locale, albumId } = await params;
  const query = await searchParams;
  const result = await getAlbumResult(albumId);
  if (result.status === 'moved') {
    permanentRedirect(
      `/${locale}/albums/${result.newId}${queryStringOf(query)}`,
    );
  }
  if (result.status === 'missing') {
    notFound();
  }
  // The grid brings its own loading/error/empty UI through the client
  // query below, so a tracks failure must not take the header with it:
  // fall back to a client-side fetch instead of rejecting the whole page.
  const initialPage = await getAlbumTracksPage(result.album.id).catch(
    () => undefined,
  );
  return (
    <div className="flex flex-col gap-8">
      <StructuredData
        data={albumStructuredData({
          album: result.album,
          locale,
          siteUrl: getSiteUrl(),
        })}
      />
      <AlbumHeader album={result.album} />
      <AlbumTracksSection albumId={result.album.id} initialPage={initialPage} />
    </div>
  );
}

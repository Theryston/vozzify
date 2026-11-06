import type { Album, Artist, TrackDetail } from '@vozzify/contracts';

import { localizedPath } from '@/lib/i18n/metadata';
import type { Locale } from '@/lib/i18n/routing';

type PageContext = { siteUrl: URL; locale: Locale };

function pageUrl(context: PageContext, path: string): string {
  return new URL(localizedPath(context.locale, path), context.siteUrl).href;
}

/** The catalog does not distinguish people from bands, so do not guess a type. */
function artistReference(name: string, url?: string) {
  return { name, ...(url ? { url } : {}) };
}

export function artistStructuredData({
  artist,
  ...context
}: PageContext & { artist: Artist }) {
  const url = pageUrl(context, `/artists/${artist.id}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name: artist.name,
    inLanguage: context.locale,
    about: { '@type': 'Thing', ...artistReference(artist.name, url) },
  };
}

export function albumStructuredData({
  album,
  ...context
}: PageContext & { album: Album }) {
  const url = pageUrl(context, `/albums/${album.id}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicAlbum',
    '@id': url,
    url,
    name: album.title,
    ...(album.coverArtUrl ? { image: album.coverArtUrl } : {}),
    byArtist: album.artists.map((artist) =>
      artistReference(artist.name, pageUrl(context, `/artists/${artist.id}`)),
    ),
  };
}

export function trackStructuredData({
  track,
  ...context
}: PageContext & { track: TrackDetail }) {
  const url = pageUrl(context, `/tracks/${track.id}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    '@id': url,
    url,
    name: track.title,
    ...(track.coverUrl ? { image: track.coverUrl } : {}),
    ...(track.durationMs === null
      ? {}
      : { duration: `PT${track.durationMs / 1000}S` }),
    byArtist: track.artistCredit.map((artist) =>
      artistReference(
        artist.name,
        artist.artistId
          ? pageUrl(context, `/artists/${artist.artistId}`)
          : undefined,
      ),
    ),
  };
}

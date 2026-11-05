import type { CatalogTrack } from '@vozzify/contracts';

import type { TrackCardProps } from '@/features/tracks/components/track-card';

/**
 * One processed Track as the generic card inputs: the joined performer
 * names become the subtitle, the stored Track cover becomes the cover, and
 * the Track identifier seeds the placeholder and always links to the
 * Track page. Shared by every catalog track list (artist, album), so they
 * all show the same card; it lives in `components/` because features may
 * import each other only through it.
 */
export function toCatalogTrackCardProps(track: CatalogTrack): TrackCardProps {
  return {
    trackId: track.id,
    title: track.title,
    subtitle: track.artists.map((artist) => artist.name).join(', '),
    coverArtUrl: track.coverUrl,
    placeholderSeed: track.id,
  };
}

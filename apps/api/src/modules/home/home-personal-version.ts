import { createHash } from 'node:crypto';
import type { HomeRow, HomeTrack, Locale } from '@vozzify/contracts';

/** Names a snapshot with its owner, locale and full row composition. */
export const personalHomeVersion = (
  userId: string,
  locale: Locale,
  algorithmVersion: number,
  rows: HomeRow[],
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        audience: 'personal',
        algorithmVersion,
        userId,
        locale,
        rows,
      }),
    )
    .digest('hex')
    .slice(0, 16);

/**
 * Artist links are added after a snapshot version is computed; removing them
 * keeps retired cursors verifiable after serving-time enrichment.
 */
export const personalHomeVersionFromStoredRows = (
  userId: string,
  locale: Locale,
  algorithmVersion: number,
  rows: HomeRow[],
): string =>
  personalHomeVersion(
    userId,
    locale,
    algorithmVersion,
    rows.map((row) => {
      if (row.layout === 'hero') {
        return { ...row, track: withoutArtistLinks(row.track) };
      }
      if (row.layout === 'vocal-range') {
        return {
          ...row,
          items: row.items.map((track) => ({
            ...withoutArtistLinks(track),
            vocalRange: track.vocalRange,
          })),
        };
      }
      if (row.layout === 'standard' || row.layout === 'ranked') {
        return { ...row, items: row.items.map(withoutArtistLinks) };
      }
      return row;
    }),
  );

const withoutArtistLinks = (track: HomeTrack): HomeTrack => ({
  ...track,
  artistCredit: track.artistCredit.map(
    ({ artistId: _artistId, ...credit }) => credit,
  ),
});

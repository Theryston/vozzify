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
        return {
          ...row,
          track: withoutArtistLinks(row.track, hasUnlinkedTasteCredits(row.id)),
        };
      }
      if (row.layout === 'vocal-range') {
        return {
          ...row,
          items: row.items.map((track) => ({
            ...withoutArtistLinks(track, hasUnlinkedTasteCredits(row.id)),
            vocalRange: track.vocalRange,
          })),
        };
      }
      if (row.layout === 'standard' || row.layout === 'ranked') {
        return {
          ...row,
          items: row.items.map((track) =>
            withoutArtistLinks(track, hasUnlinkedTasteCredits(row.id)),
          ),
        };
      }
      return row;
    }),
  );

const hasUnlinkedTasteCredits = (rowId: string): boolean =>
  rowId === 'because-you-sang' ||
  rowId === 'more-of-your-genres' ||
  rowId === 'explore';

const withoutArtistLinks = (
  track: HomeTrack,
  preserveNullArtistIds: boolean,
): HomeTrack => ({
  ...track,
  artistCredit: track.artistCredit.map((credit) => {
    if (preserveNullArtistIds) return { ...credit, artistId: null };
    const { artistId: _artistId, ...original } = credit;
    return original;
  }),
});

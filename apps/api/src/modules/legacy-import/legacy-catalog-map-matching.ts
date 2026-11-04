/** A credited MusicBrainz identity observed on an accepted Recording. */
export type LegacyArtistEvidence = {
  mbid: string;
  creditedNames: readonly string[];
};

/** A release group observed as an actual release of an accepted Recording. */
export type LegacyAlbumEvidence = {
  mbid: string;
  title: string;
  artistMbids: readonly string[];
};

export type LegacyMapDecision =
  | { status: 'mapped'; mbid: string }
  | { status: 'unresolved'; reason: 'no-match' | 'ambiguous' | 'conflict' };

const comparable = (value: string): string =>
  value.normalize('NFC').trim().toLocaleLowerCase('en');

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * Maps only when each planned occurrence of this legacy Artist agrees on one
 * MBID through an exact credited name in its accepted Recording context.
 */
export const matchLegacyArtist = (
  legacyName: string,
  occurrences: readonly (readonly LegacyArtistEvidence[])[],
): LegacyMapDecision => {
  if (occurrences.length === 0)
    return { status: 'unresolved', reason: 'no-match' };
  const matches = occurrences.map((evidence) =>
    unique(
      evidence
        .filter((artist) =>
          artist.creditedNames.some(
            (name) => comparable(name) === comparable(legacyName),
          ),
        )
        .map((artist) => artist.mbid),
    ),
  );
  return decideAcrossOccurrences(matches);
};

/**
 * Maps only when each planned occurrence names one same release group whose
 * catalog title exactly matches the legacy Album context.
 */
export const matchLegacyAlbum = (
  legacyTitle: string,
  occurrences: readonly {
    albums: readonly LegacyAlbumEvidence[];
    recordingArtistMbids: readonly string[];
  }[],
): LegacyMapDecision => {
  if (occurrences.length === 0)
    return { status: 'unresolved', reason: 'no-match' };
  const matches = occurrences.map((evidence) =>
    unique(
      evidence.albums
        .filter((album) => comparable(album.title) === comparable(legacyTitle))
        .filter((album) =>
          album.artistMbids.some((mbid) =>
            evidence.recordingArtistMbids.includes(mbid),
          ),
        )
        .map((album) => album.mbid),
    ),
  );
  return decideAcrossOccurrences(matches);
};

const decideAcrossOccurrences = (
  matches: readonly string[][],
): LegacyMapDecision => {
  if (matches.some((candidate) => candidate.length === 0)) {
    return { status: 'unresolved', reason: 'no-match' };
  }
  if (matches.some((candidate) => candidate.length > 1)) {
    return { status: 'unresolved', reason: 'ambiguous' };
  }
  const mbids = unique(matches.map((candidate) => candidate[0] ?? ''));
  const mbid = mbids[0];
  if (mbids.length !== 1 || mbid === undefined || mbid === '') {
    return { status: 'unresolved', reason: 'conflict' };
  }
  return { status: 'mapped', mbid };
};

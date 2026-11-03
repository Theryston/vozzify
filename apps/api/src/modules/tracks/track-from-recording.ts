import type { Recording, TrackArtistCreditEntry } from '@vozzify/contracts';

// The rows a new Track is made of, mapped from the Music catalog's Recording:
// the core row and the companion tables that the Track page shows. Pure, so
// the rules (one row per release, the first year of a release, the credit in
// order) are tested without a database.

export type NewTrackCoreRow = {
  recordingMbid: string;
  primaryReleaseMbid: string | null;
  title: string;
  lengthMs: number | null;
  disambiguation: string;
  video: boolean;
  isrcs: string[];
  genres: string[];
  /** Each entry also keeps the MBID of the artist it names, which links it to an Artist. */
  artistCredit: (TrackArtistCreditEntry & { mbid: string })[];
};

type NewTrackRelease = {
  mbid: string;
  title: string;
  year: number | null;
  coverArtUrl: string | null;
};

type NewTrackWork = { mbid: string; title: string };

type NewTrackTag = { name: string; count: number };

type NewTrackExternalLink = { url: string; linkType: string };

export type NewTrackRows = {
  track: NewTrackCoreRow;
  releases: NewTrackRelease[];
  works: NewTrackWork[];
  tags: NewTrackTag[];
  externalLinks: NewTrackExternalLink[];
};

/** The first occurrence of each key, in the order given. */
function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

/**
 * The year of a partial MusicBrainz date (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`);
 * null when the release has no date.
 */
const yearOf = (date: string | null): number | null =>
  date === null ? null : Number(date.slice(0, 4));

/**
 * Maps a Recording to the rows of its Track. A Recording that sits on two
 * tracks of one release appears once per release; the catalog lists the
 * releases in the order the Track page shows them.
 */
export function trackRowsFromRecording(recording: Recording): NewTrackRows {
  return {
    track: {
      recordingMbid: recording.mbid,
      // The catalog orders releases by the same full date used in search.
      primaryReleaseMbid: recording.releases[0]?.mbid ?? null,
      title: recording.title,
      lengthMs: recording.lengthMs,
      disambiguation: recording.disambiguation,
      video: recording.video,
      isrcs: recording.isrcs,
      genres: recording.genres.map((genre) => genre.name),
      // The credit as printed: each artist under the name the credit gives it,
      // with the text that joins it to the next one.
      artistCredit: recording.artistCredit.artists.map((artist) => ({
        name: artist.creditedName,
        joinPhrase: artist.joinPhrase,
        mbid: artist.mbid,
      })),
    },
    releases: uniqueBy(recording.releases, (release) => release.mbid).map(
      (release) => ({
        mbid: release.mbid,
        title: release.title,
        year: yearOf(release.date),
        coverArtUrl: release.coverArtUrl,
      }),
    ),
    works: uniqueBy(recording.works, (work) => work.mbid).map((work) => ({
      mbid: work.mbid,
      title: work.title,
    })),
    tags: recording.tags.map((tag) => ({ name: tag.name, count: tag.count })),
    externalLinks: uniqueBy(
      recording.externalUrls,
      (link) => `${link.linkType}\n${link.url}`,
    ).map((link) => ({ url: link.url, linkType: link.linkType })),
  };
}

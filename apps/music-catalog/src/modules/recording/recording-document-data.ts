import type { TagVotesRow } from './recording-data.js';

// What the indexing queries read for a batch of Recordings, before each one
// is built into the document Meilisearch indexes. Plain rows, keyed by the
// Recording (or the artist credit) they belong to.

/** Recordings in the source and in its checkpoint-confirmed prefix. */
export type RecordingProgress = { total: number; indexed: number };

/** The Recording's own row with the printed name of its artist credit. */
export type DocumentRecordingRow = {
  /** MusicBrainz's integer id: only used to walk the Recordings in order. */
  id: number;
  mbid: string;
  title: string;
  disambiguation: string;
  artistCreditId: number;
  artistCreditName: string;
  trackId?: string | null;
  businessScore?: number | null;
};

/** The primary release selected for one Recording during index construction. */
export type PrimaryReleaseRow = { recordingId: number; mbid: string };

/** One artist of a credit with one of its aliases (null when it has none). */
export type ArtistNameRow = {
  artistCreditId: number;
  name: string;
  sortName: string;
  aliasName: string | null;
  aliasSortName: string | null;
};

/** The title of a release or a Work a Recording is on or linked to. */
export type RecordingTitleRow = { recordingId: number; title: string };

/** Genre votes at the Recording's or its release groups' level. */
export type RecordingGenreRow = TagVotesRow & { recordingId: number };

/** Genre votes at the artists' level, keyed by the artist credit. */
export type CreditGenreRow = TagVotesRow & { artistCreditId: number };

/** The genres of a batch at each level they may come from. */
type BatchGenreRows = {
  recording: RecordingGenreRow[];
  releaseGroup: RecordingGenreRow[];
  artist: CreditGenreRow[];
};

/** Everything read for a batch besides the Recordings' own rows. */
export type BatchDetails = {
  artistNames: ArtistNameRow[];
  releaseTitles: RecordingTitleRow[];
  workTitles: RecordingTitleRow[];
  primaryReleases: PrimaryReleaseRow[];
  genres: BatchGenreRows;
};

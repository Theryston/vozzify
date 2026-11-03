import type { TrackArtistCreditEntry } from '@vozzify/contracts';
import type { NewTrackRows } from './track-from-recording.js';

/** A Track as its Processing reads it (see `findPipelineTrack`). */
export type PipelineTrack = {
  id: string;
  title: string;
  /** In milliseconds; null when MusicBrainz has none. */
  lengthMs: number | null;
  coverUrl: string | null;
  primaryReleaseMbid: string | null;
  youtubeVideoId: string | null;
  /** The artists as the credit prints them, in credit order. */
  artistNames: string[];
  /** Every URL the Recording links to. */
  externalUrls: string[];
  releases: { mbid: string; title: string; year: number | null }[];
};

/** The Track fields the Processing page's header shows. */
export type TrackHeaderRow = {
  id: string;
  title: string;
  coverUrl: string | null;
  artistCredit: TrackArtistCreditEntry[];
};

/** The companion rows of a new Track (everything but the core row). */
export type NewTrackDetails = Omit<NewTrackRows, 'track'>;

/** Inserts rows only when the Recording has any. */
export async function insertIfAny<TRow>(
  rows: readonly TRow[],
  insert: (rows: TRow[]) => Promise<unknown>,
): Promise<void> {
  if (rows.length > 0) await insert([...rows]);
}

/** Adds one Track ID to each companion row. */
export const onTrack = <TRow extends object>(
  rows: readonly TRow[],
  trackId: string,
) => rows.map((row) => ({ ...row, trackId }));

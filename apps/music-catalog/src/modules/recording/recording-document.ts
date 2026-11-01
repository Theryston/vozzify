import { compareText } from '../../lib/compare.js';
import { groupBy } from '../../lib/group-by.js';
import type { RecordingDocument } from '../../lib/recordings-index.js';
import { chooseTags } from './genre-fallback.js';
import type { TagLevels } from './recording-data.js';
import type {
  ArtistNameRow,
  BatchDetails,
  DocumentRecordingRow,
} from './recording-document-data.js';

/** What the queries found for one Recording, ready to go in its document. */
export type DocumentParts = {
  /** Names, sort names and aliases of the credited artists. */
  artistNames: string[];
  releaseTitles: string[];
  workTitles: string[];
  primaryReleaseMbid: string | null;
  tagLevels: TagLevels;
};

// Each text once, blanks out, in a fixed order: the same Recording always
// produces the same document, so indexing it again changes nothing.
const uniqueTexts = (texts: readonly string[]): string[] =>
  [
    ...new Set(texts.map((text) => text.trim()).filter((text) => text !== '')),
  ].sort(compareText);

/**
 * The names people may know the credited artists by: each artist's name and
 * sort name, and the same for each alias. The credit as printed is searched
 * separately.
 */
export const artistNamesOf = (rows: readonly ArtistNameRow[]): string[] =>
  rows.flatMap((row) => [
    row.name,
    row.sortName,
    ...(row.aliasName === null ? [] : [row.aliasName]),
    ...(row.aliasSortName === null ? [] : [row.aliasSortName]),
  ]);

/**
 * Builds the document Meilisearch indexes for a Recording. No I/O: the
 * fields are the ones `RECORDINGS_INDEX_SETTINGS` searches, and the genres
 * come from the level `getRecording` takes its own from, so what a result
 * shows is what finds it.
 */
export const buildRecordingDocument = (
  row: DocumentRecordingRow,
  parts: DocumentParts,
): RecordingDocument => ({
  mbid: row.mbid,
  title: row.title,
  artistCredit: row.artistCreditName,
  artistAliases: uniqueTexts(parts.artistNames),
  releaseTitles: uniqueTexts(parts.releaseTitles),
  workTitles: uniqueTexts(parts.workTitles),
  genres: chooseTags(parts.tagLevels).genres.map((genre) => genre.name),
  disambiguation: row.disambiguation,
  primaryReleaseMbid: parts.primaryReleaseMbid,
  trackId: row.trackId ?? null,
  businessScore:
    row.trackId === null || row.trackId === undefined
      ? null
      : (row.businessScore ?? null),
});

/**
 * Builds the documents of a batch from the rows read for all of it: each
 * Recording gets the rows that belong to it (by its id, or by its artist
 * credit for the artists), in the order of `rows`.
 */
export const buildDocuments = (
  rows: readonly DocumentRecordingRow[],
  details: BatchDetails,
): RecordingDocument[] => {
  const artistNames = groupBy(details.artistNames, (r) => r.artistCreditId);
  const releaseTitles = groupBy(details.releaseTitles, (r) => r.recordingId);
  const workTitles = groupBy(details.workTitles, (r) => r.recordingId);
  const primaryReleases = new Map(
    details.primaryReleases.map((release) => [
      release.recordingId,
      release.mbid,
    ]),
  );
  const ownGenres = groupBy(details.genres.recording, (r) => r.recordingId);
  const groupGenres = groupBy(
    details.genres.releaseGroup,
    (r) => r.recordingId,
  );
  const artistGenres = groupBy(details.genres.artist, (r) => r.artistCreditId);
  return rows.map((row) =>
    buildRecordingDocument(row, {
      artistNames: artistNamesOf(artistNames.get(row.artistCreditId) ?? []),
      releaseTitles: (releaseTitles.get(row.id) ?? []).map((r) => r.title),
      workTitles: (workTitles.get(row.id) ?? []).map((r) => r.title),
      primaryReleaseMbid: primaryReleases.get(row.id) ?? null,
      tagLevels: {
        recording: ownGenres.get(row.id) ?? [],
        release_group: groupGenres.get(row.id) ?? [],
        artist: artistGenres.get(row.artistCreditId) ?? [],
      },
    }),
  );
};

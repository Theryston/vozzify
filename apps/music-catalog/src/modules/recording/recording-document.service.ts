import type { RecordingDocument } from '../../lib/recordings-index.js';
import { buildDocuments } from './recording-document.js';
import type { RecordingDocumentRepository } from './recording-document.repository.js';
import type {
  BatchDetails,
  DocumentRecordingRow,
  RecordingProgress,
} from './recording-document-data.js';

export type DocumentBatch = {
  documents: RecordingDocument[];
  /** The id to continue after to get the batch that follows this one. */
  lastRecordingId: number;
};

/** A Recording that still exists, with the document the index should hold. */
export type CurrentDocument = {
  /** MusicBrainz's integer id. */
  id: number;
  mbid: string;
  document: RecordingDocument;
};

/**
 * Describes Recordings for the search index, for the worker. Other modules
 * (indexing) use the catalog's Recordings through this service.
 */
export class RecordingDocumentService {
  constructor(private readonly repository: RecordingDocumentRepository) {}

  /**
   * The documents of the next `limit` Recordings after `afterId` (MusicBrainz's
   * integer id, the order Recordings are walked in), or undefined when there
   * are none left. All the batch is read with one query per kind of data.
   */
  async findBatch(
    afterId: number,
    limit: number,
  ): Promise<DocumentBatch | undefined> {
    const rows = await this.repository.findBatch(afterId, limit);
    const last = rows.at(-1);
    if (last === undefined) {
      return undefined;
    }
    const details = await this.loadDetails(rows);
    return {
      documents: buildDocuments(rows, details),
      lastRecordingId: last.id,
    };
  }

  /**
   * Reads cumulative progress once per run, using the last confirmed id.
   * Batches advance these counts only after their checkpoint is saved.
   */
  async countProgress(afterId: number): Promise<RecordingProgress> {
    return this.repository.countProgress(afterId);
  }

  /**
   * The documents of the Recordings with these integer ids, for the sync:
   * one entry per Recording that still exists (a deleted one has none, and
   * the sync deletes its MBIDs instead).
   */
  async findDocumentsByIds(ids: readonly number[]): Promise<CurrentDocument[]> {
    const rows = await this.repository.findByIds(ids);
    if (rows.length === 0) {
      return [];
    }
    const documents = buildDocuments(rows, await this.loadDetails(rows));
    return rows.map((row, index) => {
      const document = documents[index];
      if (document === undefined) {
        throw new Error(`No document was built for Recording ${row.id}`);
      }
      return { id: row.id, mbid: row.mbid, document };
    });
  }

  findIdsByMbids(mbids: readonly string[]): Promise<number[]> {
    return this.repository.findIdsByMbids(mbids);
  }

  private async loadDetails(
    rows: readonly DocumentRecordingRow[],
  ): Promise<BatchDetails> {
    const recordingIds = rows.map((row) => row.id);
    const artistCreditIds = [...new Set(rows.map((row) => row.artistCreditId))];
    const [
      artistNames,
      releaseTitles,
      primaryReleases,
      workTitles,
      recording,
      releaseGroup,
      artist,
    ] = await Promise.all([
      this.repository.findArtistNames(artistCreditIds),
      this.repository.findReleaseTitles(recordingIds),
      this.repository.findPrimaryReleases(recordingIds),
      this.repository.findWorkTitles(recordingIds),
      this.repository.findRecordingGenres(recordingIds),
      this.repository.findReleaseGroupGenres(recordingIds),
      this.repository.findArtistGenres(artistCreditIds),
    ]);
    return {
      artistNames,
      releaseTitles,
      primaryReleases,
      workTitles,
      genres: { recording, releaseGroup, artist },
    };
  }
}

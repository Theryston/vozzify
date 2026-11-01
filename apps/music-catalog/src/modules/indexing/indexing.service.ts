import type { MeilisearchIndex } from '../../integrations/meilisearch/meilisearch-index.js';
import {
  RECORDINGS_INDEX,
  RECORDINGS_INDEX_SETTINGS,
  type RecordingDocument,
} from '../../lib/recordings-index.js';
import type { Logger } from '../../logger.js';
import type { BootstrapService } from '../bootstrap/bootstrap.service.js';
import type { RecordingDocumentService } from '../recording/recording-document.service.js';
import type { RecordingProgress } from '../recording/recording-document-data.js';
import type { IndexingRepository } from './indexing.repository.js';
import { indexingPercent } from './indexing-progress.js';
import { runIndexingWindow } from './indexing-window.js';

export type IndexingServiceDeps = {
  bootstrap: BootstrapService;
  documents: RecordingDocumentService;
  repository: IndexingRepository;
  /** Opened with the key that can write: only the worker indexes. */
  index: MeilisearchIndex<RecordingDocument>;
  /** How many Recordings go to Meilisearch in one task. */
  batchSize: number;
  logger: Logger;
  /** Serializes complete-document replacement with Track association writes. */
  writeLock?: <Result>(run: () => Promise<Result>) => Promise<Result>;
};

export class IndexingService {
  constructor(private readonly deps: IndexingServiceDeps) {}

  /**
   * One round of the worker's initial indexing. It waits (does nothing)
   * until the mbslave container has restored the MusicBrainz data, then
   * pipelines up to two batches at a time. The checkpoint moves only
   * after each batch is confirmed, in source order, so a worker that
   * dies mid-indexing resumes after the last batch Meilisearch confirmed
   * (a batch that was sent but not checkpointed is sent again, which is
   * harmless: documents are replaced by MBID). When the last batch is in,
   * the catalog becomes `ready`. Aborting `signal` drains the batches
   * already sent; the next round continues.
   */
  async run(signal: AbortSignal): Promise<void> {
    const { bootstrap } = this.deps;
    const startedAt = Date.now();
    const { phase } = await bootstrap.getStatus();
    if (phase === 'restored') {
      await bootstrap.startIndexing();
    } else if (phase !== 'indexing') {
      return;
    }
    const total = await this.runDetached(signal);
    if (total !== undefined) {
      await bootstrap.markReady();
      this.deps.logger.info('Indexing finished: the catalog is ready', {
        total,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  /**
   * Indexes every Recording without touching the bootstrap phases: the
   * blue-green reimport walks the parallel copy this way, tracking its own
   * state instead of the first import's. Returns the Recording count, or
   * undefined when aborted before the last batch.
   */
  async runDetached(signal: AbortSignal): Promise<number | undefined> {
    const { index, repository } = this.deps;
    await index.ensure(RECORDINGS_INDEX_SETTINGS);
    const checkpoint = await repository.getCheckpoint(RECORDINGS_INDEX.uid);
    const progress = await this.deps.documents.countProgress(checkpoint);
    if (await this.indexFrom(checkpoint, progress, signal)) {
      return progress.total;
    }
    return undefined;
  }

  // Returns whether every Recording was indexed (false: stopped early).
  private async indexFrom(
    checkpoint: number,
    progress: RecordingProgress,
    signal: AbortSignal,
  ): Promise<boolean> {
    const { documents, index, repository, batchSize, logger } = this.deps;
    let afterId = checkpoint;
    const { total } = progress;
    let { indexed } = progress;
    let batchNumber = 0;
    while (!signal.aborted) {
      const writeWindow = () =>
        runIndexingWindow({
          afterId,
          batchSize,
          signal,
          documents,
          index,
          confirm: async (batch) => {
            await repository.saveCheckpoint(
              RECORDINGS_INDEX.uid,
              batch.lastRecordingId,
            );
            indexed += batch.documents.length;
            logger.info('Indexed a batch of Recordings', {
              batch: ++batchNumber,
              indexed,
              remaining: Math.max(0, total - indexed),
              total,
              percent: indexingPercent(indexed, total),
              lastRecordingId: batch.lastRecordingId,
            });
          },
        });
      const window = await (this.deps.writeLock?.(writeWindow) ??
        writeWindow());
      if (window.exhausted && !signal.aborted) return true;
      afterId = window.afterId;
    }
    logger.info('Indexing paused: the worker is stopping', { indexed });
    return false;
  }
}

import type { MeilisearchIndex } from '../../integrations/meilisearch/meilisearch-index.js';
import {
  RECORDINGS_INDEX_SETTINGS,
  type RecordingDocument,
} from '../../lib/recordings-index.js';
import type { Logger } from '../../logger.js';
import type { BootstrapService } from '../bootstrap/bootstrap.service.js';
import type {
  CurrentDocument,
  RecordingDocumentService,
} from '../recording/recording-document.service.js';
import type { TrackAssociationService } from '../track-association/track-association.service.js';
import type { RecordingOutboxRepository } from './recording-outbox.repository.js';
import { type OutboxEntry, planSync } from './sync-plan.js';

export type SyncServiceDeps = {
  bootstrap: BootstrapService;
  outbox: RecordingOutboxRepository;
  documents: RecordingDocumentService;
  /** Opened with the key that can write: only the worker syncs. */
  index: MeilisearchIndex<RecordingDocument>;
  /** How many outbox entries one batch rebuilds. */
  batchSize: number;
  logger: Logger;
  associations?: TrackAssociationService;
  /** Serializes complete-document replacement with Track association writes. */
  writeLock?: <Result>(run: () => Promise<Result>) => Promise<Result>;
};

export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {
    // Initial indexing combines smaller reads; sync reads its whole batch.
    this.deps = { ...deps, batchSize: Math.min(deps.batchSize, 10_000) };
  }

  /**
   * Installs the change triggers once the MusicBrainz tables exist (after
   * the restore, before indexing) and puts back any that went missing. A
   * no-op while the restore has not produced the tables yet, and whenever
   * every trigger is already in place.
   */
  async ensureTriggers(): Promise<void> {
    const { phase } = await this.deps.bootstrap.getStatus();
    if (phase === 'restoring') {
      return;
    }
    await this.deps.outbox.ensureTriggers();
  }

  /**
   * The oldest outbox entries still waiting to reach the index. It never
   * marks anything, so the drain below still owns every entry.
   */
  async peekPending(limit: number): Promise<OutboxEntry[]> {
    return this.deps.outbox.peekPending(limit);
  }

  /**
   * Brings the index up to date with the outbox: each batch rebuilds the
   * documents of the Recordings its entries touch (or deletes the MBIDs
   * whose rows are gone) and only then marks the entries done, so a worker
   * that dies mid-batch reprocesses what is left on its return. Runs only
   * once the catalog is ready; the initial indexing owns everything before.
   * Aborting `signal` stops it after the batch in progress.
   */
  async drain(signal: AbortSignal): Promise<void> {
    const { bootstrap, outbox, documents, index, batchSize, logger } =
      this.deps;
    const { phase } = await bootstrap.getStatus();
    if (phase !== 'ready') {
      return;
    }
    // Roll out the new rule on the existing index before score projections
    // start adding the field; this settings update never rewrites documents.
    await index.ensure(RECORDINGS_INDEX_SETTINGS);
    let synced = 0;
    while (!signal.aborted) {
      const entries = await outbox.peekPending(batchSize);
      if (entries.length === 0) {
        break;
      }
      const ids = [...new Set(entries.map((entry) => entry.recordingId))];
      const syncBatch = async (): Promise<void> => {
        const found: CurrentDocument[] =
          await documents.findDocumentsByIds(ids);
        const current = new Map(
          found.map((recording) => [
            recording.id,
            { mbid: recording.mbid, document: recording.document },
          ]),
        );
        const plan = planSync(entries, current);
        await index.upsert(plan.upserts);
        await index.deleteDocuments(plan.deletes);
        await outbox.markProcessed(entries);
      };
      await (this.deps.writeLock?.(syncBatch) ?? syncBatch());
      synced += entries.length;
      logger.info('Synced a batch of Recordings', {
        synced,
        recordings: ids.length,
      });
    }
    await this.drainPendingAssociations(batchSize);
    logger.info('Sync drained the pending MusicBrainz changes', { synced });
  }

  async drainAssociations(): Promise<void> {
    const { associations, index, batchSize } = this.deps;
    if (associations === undefined) return;
    await index.ensure(RECORDINGS_INDEX_SETTINGS);
    await this.drainPendingAssociations(batchSize);
  }

  private async drainPendingAssociations(limit: number): Promise<void> {
    const { associations, index, writeLock } = this.deps;
    if (associations === undefined) return;
    let afterMbid: string | undefined;
    const processBatch = async (): Promise<string[]> => {
      const entries = await associations.peekPending(limit, afterMbid);
      const projected = await Promise.all(
        entries.map(async (entry) => ({
          entry,
          exists: await index.hasDocument(entry.mbid),
        })),
      );
      const indexed = projected.filter((item) => item.exists);
      if (indexed.length > 0) {
        await index.updateDocuments(
          indexed.map(({ entry }) => ({
            mbid: entry.mbid,
            trackId: entry.trackId,
            businessScore: entry.trackId === null ? null : entry.businessScore,
          })),
        );
        await associations.markIndexed(indexed.map(({ entry }) => entry));
      }
      return entries.map((entry) => entry.mbid);
    };
    while (true) {
      const mbids = await (writeLock?.(processBatch) ?? processBatch());
      if (mbids.length === 0) return;
      afterMbid = mbids.at(-1);
      if (mbids.length < limit) return;
    }
  }
}

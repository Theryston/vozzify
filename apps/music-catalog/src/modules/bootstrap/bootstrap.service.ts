import type {
  CatalogDataset,
  MusicCatalogReimportStatus,
  MusicCatalogStatusResult,
  ReplicationStalled,
} from '@vozzify/contracts';
import { CatalogError } from '../../errors/catalog-error.js';
import type { BootstrapRepository } from './bootstrap.repository.js';

/**
 * Where `getStatus` reads the replication numbers when they are available:
 * the recorded sequence with the outbox backlog. Declared structurally so
 * this module never imports the replication module (the service behind it
 * satisfies it); `ReplicationService` is built for the server's status, and
 * left out wherever nothing answers `status` (unit contexts, the worker).
 */
export type ReplicationStatusSource = {
  report: () => Promise<{
    replicationSequence: number | null;
    pendingOutbox: number;
    replicationStalled?: ReplicationStalled;
  }>;
};

/**
 * Where `getStatus` reads the reimport progress when one runs. Satisfied by
 * `ReimportService`; absent without a parallel database.
 */
export type ReimportStatusSource = {
  reportReimport: () => Promise<MusicCatalogReimportStatus | undefined>;
};

/**
 * Adopts the reimported copy without restarting: flips this process's reads
 * to the parallel database once `reimport_state` says `switched`. Runs on
 * phase and status reads, and short-circuits once adopted, so the steady
 * state costs nothing.
 */
export type CutoverWatcher = {
  adoptIfSwitched: (
    queryTimeoutMs?: number,
    shouldContinue?: () => boolean,
  ) => Promise<void>;
};

export class BootstrapService {
  constructor(
    private readonly repository: BootstrapRepository,
    /** The dataset this deployment is configured for (`CATALOG_DATASET`). */
    private readonly configuredDataset: CatalogDataset,
    /** Adds the replication numbers to `getStatus`; absent without them. */
    private readonly replication?: ReplicationStatusSource,
    /** The reimport progress with the cutover; absent without a reimport. */
    private readonly reimport?: {
      status?: ReimportStatusSource;
      cutover?: CutoverWatcher;
    },
  ) {}

  /**
   * Where the first import stands. The mbslave container and the worker
   * record it in the database; a server that starts before anything has been
   * written still answers, with the import as not started yet. With a
   * replication source, the answer also carries the last applied sequence
   * and the outbox backlog, read together so they describe the same moment;
   * while a reimport runs it also carries its phase and progress, and the
   * first import's phase stays `ready` throughout.
   */
  async getStatus(): Promise<MusicCatalogStatusResult> {
    await this.reimport?.cutover?.adoptIfSwitched();
    const state = await this.repository.getState();
    const base = state ?? {
      phase: 'restoring' as const,
      dataset: this.configuredDataset,
    };
    const withReplication = this.replication
      ? { ...base, ...(await this.replication.report()) }
      : base;
    const reimport = await this.reimport?.status?.reportReimport();
    return reimport === undefined
      ? withReplication
      : { ...withReplication, reimport };
  }

  /**
   * Reads the first-import phase for metadata and search readiness, adopting
   * a completed blue-green cutover before the database reference is read.
   */
  async getImportPhase(options?: {
    queryTimeoutMs?: number;
    shouldContinue?: () => boolean;
  }): Promise<MusicCatalogStatusResult['phase']> {
    await this.reimport?.cutover?.adoptIfSwitched(
      options?.queryTimeoutMs,
      options?.shouldContinue,
    );
    return (
      (await this.repository.getState(options?.queryTimeoutMs))?.phase ??
      'restoring'
    );
  }

  /**
   * Refuses the request while the first import has not finished, for every
   * operation that reads the catalog (`status` is the one that may answer
   * meanwhile). Only the phase gates reads: status statistics may be slow.
   * The state is read on every call, so it follows the worker.
   */
  async assertReady(): Promise<void> {
    const phase = await this.getImportPhase();
    if (phase !== 'ready') {
      throw new CatalogError(
        'CATALOG_NOT_READY',
        `The catalog is still importing (phase: ${phase})`,
      );
    }
  }

  /**
   * The worker takes over from the mbslave container: the restore is done
   * (`restored`) and it starts indexing. A no-op in any other phase, so a
   * worker that restarts while indexing just goes on.
   */
  async startIndexing(): Promise<void> {
    await this.repository.advance({ from: 'restored', to: 'indexing' });
  }

  /** Every Recording is indexed: from now on the catalog answers searches. */
  async markReady(): Promise<void> {
    await this.repository.advance({ from: 'indexing', to: 'ready' });
  }
}

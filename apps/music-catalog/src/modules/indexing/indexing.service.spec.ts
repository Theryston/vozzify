import type { BootstrapPhase } from '@vozzify/contracts';
import type { MeilisearchIndex } from '../../integrations/meilisearch/meilisearch-index.js';
import {
  RECORDINGS_INDEX,
  RECORDINGS_INDEX_SETTINGS,
  type RecordingDocument,
} from '../../lib/recordings-index.js';
import type { BootstrapService } from '../bootstrap/bootstrap.service.js';
import type { RecordingDocumentService } from '../recording/recording-document.service.js';
import type { IndexingRepository } from './indexing.repository.js';
import {
  IndexingService,
  type IndexingServiceDeps,
} from './indexing.service.js';

const doc = (id: number): RecordingDocument => ({
  mbid: `mbid-${id}`,
  title: `Title ${id}`,
  artistCredit: 'Artist',
  primaryReleaseMbid: null,
  artistAliases: [],
  releaseTitles: [],
  workTitles: [],
  genres: [],
  disambiguation: '',
});

// Existing Recordings, served `size` at a time after the given id.
const catalog =
  (recordingIds: readonly number[]) =>
  async (afterId: number, size: number) => {
    const ids = recordingIds.filter((id) => id > afterId).slice(0, size);
    const last = ids.at(-1);
    return last === undefined
      ? undefined
      : { documents: ids.map(doc), lastRecordingId: last };
  };

type Options = {
  phase?: BootstrapPhase;
  total?: number;
  checkpoint?: number;
  batchSize?: number;
  recordingIds?: number[];
  writeLock?: IndexingServiceDeps['writeLock'];
};

const setup = (options: Options = {}) => {
  const events: string[] = [];
  const bootstrap = {
    getStatus: vi.fn(async () => ({
      phase: options.phase ?? 'restored',
      dataset: 'tiny' as const,
    })),
    startIndexing: vi.fn(async () => {
      events.push('startIndexing');
    }),
    markReady: vi.fn(async () => {
      events.push('markReady');
    }),
  };
  const ids =
    options.recordingIds ??
    Array.from({ length: options.total ?? 5 }, (_, i) => i + 1);
  const documents = {
    findBatch: vi.fn(catalog(ids)),
    countProgress: vi.fn(async (afterId: number) => ({
      total: ids.length,
      indexed: ids.filter((id) => id <= afterId).length,
    })),
  };
  const repository = {
    getCheckpoint: vi.fn(async () => options.checkpoint ?? 0),
    saveCheckpoint: vi.fn(async (_uid: string, last: number) => {
      events.push(`checkpoint ${last}`);
    }),
  };
  const index = {
    ensure: vi.fn(async () => {
      events.push('ensure');
    }),
    upsert: vi.fn(async (batch: RecordingDocument[]) => {
      events.push(`upsert ${batch.map((d) => d.mbid).join(',')}`);
    }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new IndexingService({
    bootstrap: bootstrap as unknown as BootstrapService,
    documents: documents as unknown as RecordingDocumentService,
    repository: repository as unknown as IndexingRepository,
    index: index as unknown as MeilisearchIndex<RecordingDocument>,
    batchSize: options.batchSize ?? 2,
    logger,
    writeLock: options.writeLock,
  });
  return { service, bootstrap, documents, repository, index, logger, events };
};

const signal = () => new AbortController().signal;

describe('IndexingService', () => {
  describe('run', () => {
    it('holds the write fence until submitted tasks settle and releases it between windows', async () => {
      let locked = false;
      let windows = 0;
      let releaseTasks = (): void => undefined;
      const pending = new Promise<void>((resolve) => {
        releaseTasks = resolve;
      });
      const writeLock = async <Result>(run: () => Promise<Result>) => {
        windows++;
        locked = true;
        try {
          return await run();
        } finally {
          locked = false;
        }
      };
      const { service, index, repository } = setup({
        total: 7,
        batchSize: 2,
        writeLock,
      });
      index.upsert.mockImplementation(async () => {
        expect(locked).toBe(true);
        await pending;
      });
      const running = service.run(signal());
      await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
      expect(locked).toBe(true);
      expect(repository.saveCheckpoint).not.toHaveBeenCalled();
      releaseTasks();
      await running;
      expect(locked).toBe(false);
      expect(windows).toBe(2);
      expect(repository.saveCheckpoint.mock.calls.map(([, id]) => id)).toEqual([
        2, 4, 6, 7,
      ]);
    });

    it('indexes every Recording in batches and only then marks the catalog ready', async () => {
      const { service, events } = setup({ total: 5, batchSize: 2 });

      await service.run(signal());

      expect(events).toEqual([
        'startIndexing',
        'ensure',
        'upsert mbid-1,mbid-2',
        'upsert mbid-3,mbid-4',
        'checkpoint 2',
        'checkpoint 4',
        'upsert mbid-5',
        'checkpoint 5',
        'markReady',
      ]);
    });

    it('applies the index settings before sending any document', async () => {
      const { service, index } = setup();

      await service.run(signal());

      expect(index.ensure).toHaveBeenCalledExactlyOnceWith(
        RECORDINGS_INDEX_SETTINGS,
      );
    });

    it('keeps its checkpoint under the name of the index', async () => {
      const { service, repository } = setup({ total: 1 });

      await service.run(signal());

      expect(repository.getCheckpoint).toHaveBeenCalledWith(
        RECORDINGS_INDEX.uid,
      );
      expect(repository.saveCheckpoint).toHaveBeenCalledWith(
        RECORDINGS_INDEX.uid,
        1,
      );
    });

    it('says when it is done', async () => {
      const { service, logger } = setup({ total: 1 });

      await service.run(signal());

      expect(logger.info).toHaveBeenLastCalledWith(
        'Indexing finished: the catalog is ready',
        expect.objectContaining({ total: 1 }),
      );
    });

    it('marks an empty catalog ready after setting the index up', async () => {
      const { service, events } = setup({ total: 0 });

      await service.run(signal());

      expect(events).toEqual(['startIndexing', 'ensure', 'markReady']);
    });

    it('reports a zero total when the catalog is empty', async () => {
      const { service, logger } = setup({ total: 0 });

      await service.run(signal());

      expect(logger.info).toHaveBeenLastCalledWith(
        'Indexing finished: the catalog is ready',
        expect.objectContaining({ total: 0 }),
      );
    });

    it('asks for batches of the configured size', async () => {
      const { service, documents } = setup({ total: 3, batchSize: 7 });

      await service.run(signal());

      expect(documents.findBatch).toHaveBeenNthCalledWith(1, 0, 7);
    });

    it('logs the progress of each batch', async () => {
      const { service, logger } = setup({ total: 3, batchSize: 2 });

      await service.run(signal());

      expect(logger.info).toHaveBeenCalledWith(
        'Indexed a batch of Recordings',
        {
          batch: 1,
          indexed: 2,
          remaining: 1,
          total: 3,
          percent: 67,
          lastRecordingId: 2,
        },
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Indexed a batch of Recordings',
        {
          batch: 2,
          indexed: 3,
          remaining: 0,
          total: 3,
          percent: 100,
          lastRecordingId: 3,
        },
      );
    });

    it('reads cumulative counts once per run, never per batch', async () => {
      const { service, documents } = setup({ total: 5, batchSize: 2 });

      await service.run(signal());

      expect(documents.countProgress).toHaveBeenCalledExactlyOnceWith(0);
    });

    describe('when the worker is restarted in the middle of indexing', () => {
      it('logs confirmed progress from previous runs and the remaining Recordings', async () => {
        const { service, logger } = setup({
          phase: 'indexing',
          recordingIds: [10, 40, 90, 130, 1000],
          checkpoint: 40,
          batchSize: 2,
        });

        await service.run(signal());

        expect(logger.info).toHaveBeenCalledWith(
          'Indexed a batch of Recordings',
          {
            batch: 1,
            indexed: 4,
            remaining: 1,
            total: 5,
            percent: 80,
            lastRecordingId: 130,
          },
        );
        expect(logger.info).toHaveBeenCalledWith(
          'Indexed a batch of Recordings',
          {
            batch: 2,
            indexed: 5,
            remaining: 0,
            total: 5,
            percent: 100,
            lastRecordingId: 1000,
          },
        );
      });

      it('recounts confirmed progress on retry without including a failed batch', async () => {
        const { service, index, repository, documents, logger } = setup({
          phase: 'indexing',
          total: 5,
          checkpoint: 2,
        });
        index.upsert
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('task failed'));

        await expect(service.run(signal())).rejects.toThrow('task failed');

        expect(repository.saveCheckpoint.mock.calls).toEqual([
          [RECORDINGS_INDEX.uid, 4],
        ]);
        expect(logger.info).toHaveBeenCalledExactlyOnceWith(
          'Indexed a batch of Recordings',
          expect.objectContaining({ indexed: 4, remaining: 1, percent: 80 }),
        );
        repository.getCheckpoint.mockResolvedValue(4);
        logger.info.mockClear();

        await service.run(signal());

        expect(documents.countProgress.mock.calls).toEqual([[2], [4]]);
        expect(logger.info).toHaveBeenCalledWith(
          'Indexed a batch of Recordings',
          expect.objectContaining({ indexed: 5, remaining: 0, percent: 100 }),
        );
      });

      it('keeps cumulative progress in the pause log', async () => {
        const controller = new AbortController();
        controller.abort();
        const { service, logger } = setup({
          phase: 'indexing',
          recordingIds: [10, 40, 90],
          checkpoint: 40,
        });

        await service.run(controller.signal);

        expect(logger.info).toHaveBeenLastCalledWith(
          'Indexing paused: the worker is stopping',
          { indexed: 2 },
        );
      });

      it('goes on after the checkpoint instead of starting over', async () => {
        const { service, documents, bootstrap, events } = setup({
          phase: 'indexing',
          total: 5,
          checkpoint: 4,
        });

        await service.run(signal());

        expect(documents.findBatch).toHaveBeenNthCalledWith(1, 4, 2);
        expect(bootstrap.startIndexing).not.toHaveBeenCalled();
        expect(events).toEqual([
          'ensure',
          'upsert mbid-5',
          'checkpoint 5',
          'markReady',
        ]);
      });
    });

    describe('when indexing cannot run yet or is over', () => {
      it.each(['restoring', 'ready'] as const)(
        'does nothing in the %s phase',
        async (phase) => {
          const { service, index, documents, bootstrap } = setup({ phase });

          await service.run(signal());

          expect(index.ensure).not.toHaveBeenCalled();
          expect(documents.findBatch).not.toHaveBeenCalled();
          expect(bootstrap.startIndexing).not.toHaveBeenCalled();
          expect(bootstrap.markReady).not.toHaveBeenCalled();
        },
      );
    });

    describe('when the worker is asked to stop', () => {
      it('stops after the batch in progress, leaving the catalog not ready', async () => {
        const controller = new AbortController();
        const { service, index, events } = setup({ total: 6, batchSize: 2 });
        index.upsert.mockImplementationOnce(async () => {
          events.push('upsert mbid-1,mbid-2');
          controller.abort();
        });

        await service.run(controller.signal);

        expect(events).toEqual([
          'startIndexing',
          'ensure',
          'upsert mbid-1,mbid-2',
          'checkpoint 2',
        ]);
      });

      it('says it paused, and how far it got', async () => {
        const controller = new AbortController();
        const { service, index, logger } = setup({ total: 6, batchSize: 2 });
        index.upsert.mockImplementationOnce(async () => {
          controller.abort();
        });

        await service.run(controller.signal);

        expect(logger.info).toHaveBeenLastCalledWith(
          'Indexing paused: the worker is stopping',
          { indexed: 2 },
        );
      });

      it('starts no batch when it was already told to stop', async () => {
        const controller = new AbortController();
        controller.abort();
        const { service, documents, bootstrap } = setup();

        await service.run(controller.signal);

        expect(documents.findBatch).not.toHaveBeenCalled();
        expect(bootstrap.markReady).not.toHaveBeenCalled();
      });
    });

    describe('when Meilisearch fails', () => {
      it('does not checkpoint the batch that failed, nor mark the catalog ready', async () => {
        const { service, index, events } = setup({ total: 4, batchSize: 2 });
        index.upsert
          .mockImplementationOnce(async () => {
            events.push('upsert mbid-1,mbid-2');
          })
          .mockRejectedValueOnce(new Error('Meilisearch is down'));

        await expect(service.run(signal())).rejects.toThrow(
          'Meilisearch is down',
        );

        expect(events).toEqual([
          'startIndexing',
          'ensure',
          'upsert mbid-1,mbid-2',
          'checkpoint 2',
        ]);
      });
    });
  });
});

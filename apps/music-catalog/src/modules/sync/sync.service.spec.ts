import type { MeilisearchIndex } from '../../integrations/meilisearch/meilisearch-index.js';
import type { RecordingDocument } from '../../lib/recordings-index.js';
import type { Logger } from '../../logger.js';
import type { BootstrapService } from '../bootstrap/bootstrap.service.js';
import type {
  CurrentDocument,
  RecordingDocumentService,
} from '../recording/recording-document.service.js';
import type { TrackAssociationService } from '../track-association/track-association.service.js';
import type { RecordingOutboxRepository } from './recording-outbox.repository.js';
import { SyncService } from './sync.service.js';
import type { OutboxEntry } from './sync-plan.js';

const document = (mbid: string): RecordingDocument => ({
  mbid,
  title: `Title of ${mbid}`,
  artistCredit: 'Artist',
  primaryReleaseMbid: null,
  artistAliases: ['Artist'],
  releaseTitles: [],
  workTitles: [],
  genres: [],
  disambiguation: '',
});

const entry = (recordingId: number, recordingMbid: string): OutboxEntry => ({
  recordingId,
  recordingMbid,
  enqueuedAt: new Date('2026-01-01T00:00:00Z'),
});

const found = (id: number, mbid: string): CurrentDocument => ({
  id,
  mbid,
  document: document(mbid),
});

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const setup = (
  options: {
    phase?: string;
    pending?: OutboxEntry[][];
    documents?: Map<number, CurrentDocument>;
    associationPending?: string[];
    batchSize?: number;
  } = {},
) => {
  const batches = options.pending ?? [];
  const bootstrap = {
    getStatus: vi.fn(async () => ({
      phase: options.phase ?? 'ready',
      dataset: 'tiny' as const,
    })),
  };
  const outbox = {
    ensureTriggers: vi.fn(async () => undefined),
    peekPending: vi.fn(async () => batches.shift() ?? []),
    markProcessed: vi.fn(async () => undefined),
  };
  const documents = {
    findIdsByMbids: vi.fn(async () => [7]),
    findDocumentsByIds: vi.fn(async (ids: readonly number[]) => {
      const known = options.documents ?? new Map();
      return ids.flatMap((id) => {
        const recording = known.get(id);
        return recording === undefined ? [] : [recording];
      });
    }),
  };
  const index = {
    upsert: vi.fn(async () => undefined),
    deleteDocuments: vi.fn(async () => undefined),
  };
  const associations = {
    peekPending: vi.fn(async (_limit: number, afterMbid?: string) =>
      afterMbid === undefined ? (options.associationPending ?? []) : [],
    ),
    markIndexed: vi.fn(async () => undefined),
  };
  const service = new SyncService({
    bootstrap: bootstrap as unknown as BootstrapService,
    outbox: outbox as unknown as RecordingOutboxRepository,
    documents: documents as unknown as RecordingDocumentService,
    index: index as unknown as MeilisearchIndex<RecordingDocument>,
    batchSize: options.batchSize ?? 100,
    associations: associations as unknown as TrackAssociationService,
    logger: silentLogger,
  });
  return { service, bootstrap, outbox, documents, index, associations };
};

const liveSignal = new AbortController().signal;

describe('SyncService.ensureTriggers', () => {
  it('leaves the MusicBrainz tables alone while the restore has not produced them', async () => {
    const { service, outbox } = setup({ phase: 'restoring' });

    await service.ensureTriggers();

    expect(outbox.ensureTriggers).not.toHaveBeenCalled();
  });

  it.each(['restored', 'indexing', 'ready'])(
    'installs the triggers once the phase is %s',
    async (phase) => {
      const { service, outbox } = setup({ phase });

      await service.ensureTriggers();

      expect(outbox.ensureTriggers).toHaveBeenCalledOnce();
    },
  );
});

describe('SyncService.drain', () => {
  it.each([
    [100, 100],
    [50_000, 10_000],
  ])(
    'keeps sync and association reads bounded for batch size %s',
    async (batchSize, limit) => {
      const { service, outbox, associations } = setup({ batchSize });
      await service.drain(liveSignal);
      expect(outbox.peekPending).toHaveBeenCalledExactlyOnceWith(limit);
      expect(associations.peekPending).toHaveBeenCalledExactlyOnceWith(
        limit,
        undefined,
      );
    },
  );

  it('does nothing before the catalog is ready', async () => {
    const { service, outbox, index } = setup({
      phase: 'indexing',
      pending: [[entry(7, 'mbid-7')]],
    });

    await service.drain(liveSignal);

    expect(outbox.peekPending).not.toHaveBeenCalled();
    expect(index.upsert).not.toHaveBeenCalled();
  });

  it('does nothing when no change waits', async () => {
    const { service, outbox, index } = setup({ pending: [[]] });

    await service.drain(liveSignal);

    expect(index.upsert).not.toHaveBeenCalled();
    expect(index.deleteDocuments).not.toHaveBeenCalled();
    expect(outbox.markProcessed).not.toHaveBeenCalled();
  });

  it('reindexes changed Recordings and marks their entries done', async () => {
    const { service, outbox, documents, index } = setup({
      pending: [[entry(7, 'mbid-7')], []],
      documents: new Map([[7, found(7, 'mbid-7')]]),
    });

    await service.drain(liveSignal);

    expect(documents.findDocumentsByIds).toHaveBeenCalledWith([7]);
    expect(index.upsert).toHaveBeenCalledWith([document('mbid-7')]);
    expect(index.deleteDocuments).toHaveBeenCalledWith([]);
    expect(outbox.markProcessed).toHaveBeenCalledWith([entry(7, 'mbid-7')]);
  });

  it('deletes the MBIDs whose rows are gone', async () => {
    const { service, index, outbox } = setup({
      pending: [[entry(7, 'mbid-gone')], []],
    });

    await service.drain(liveSignal);

    expect(index.upsert).toHaveBeenCalledWith([]);
    expect(index.deleteDocuments).toHaveBeenCalledWith(['mbid-gone']);
    expect(outbox.markProcessed).toHaveBeenCalledOnce();
  });

  it('drains every pending batch of one tick', async () => {
    const { service, outbox } = setup({
      pending: [[entry(7, 'mbid-7')], [entry(8, 'mbid-8')], []],
      documents: new Map([
        [7, found(7, 'mbid-7')],
        [8, found(8, 'mbid-8')],
      ]),
    });

    await service.drain(liveSignal);

    expect(outbox.peekPending).toHaveBeenCalledTimes(3);
    expect(outbox.markProcessed).toHaveBeenCalledTimes(2);
  });

  it('stops after the batch in progress when asked to', async () => {
    const { service, outbox } = setup({
      pending: [[entry(7, 'mbid-7')], [entry(8, 'mbid-8')], []],
      documents: new Map([
        [7, found(7, 'mbid-7')],
        [8, found(8, 'mbid-8')],
      ]),
    });
    const controller = new AbortController();
    controller.abort();

    await service.drain(controller.signal);

    expect(outbox.peekPending).not.toHaveBeenCalled();
  });
});

describe('SyncService.drainAssociations', () => {
  it('keeps a failed index update pending and retries it after a worker restart', async () => {
    const { service, index, associations } = setup({
      associationPending: ['mbid-7'],
      documents: new Map([[7, found(7, 'mbid-7')]]),
    });
    index.upsert.mockRejectedValueOnce(new Error('Meilisearch task failed'));

    await expect(service.drainAssociations()).rejects.toThrow(
      'Meilisearch task failed',
    );
    expect(associations.markIndexed).not.toHaveBeenCalled();

    const restarted = setup({
      associationPending: ['mbid-7'],
      documents: new Map([[7, found(7, 'mbid-7')]]),
    });
    await restarted.service.drainAssociations();

    expect(restarted.index.upsert).toHaveBeenCalledWith([document('mbid-7')]);
    expect(restarted.associations.markIndexed).toHaveBeenCalledWith(['mbid-7']);
  });
});

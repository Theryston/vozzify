import { MeilisearchIndex } from '../src/integrations/meilisearch/meilisearch-index.js';
import { testLogger, useTestServer } from './utils/create-test-server.js';
import { setBootstrapState } from './utils/database.js';
import {
  addArtist,
  addRecording,
  deleteRecording,
  mbid,
} from './utils/musicbrainz.js';
import { requestSearch } from './utils/search-client.js';
import {
  createTestWorker,
  indexCatalog,
  meilisearchSettings,
  useEmptySearchIndex,
} from './utils/test-worker.js';
import { useTestClient } from './utils/use-test-client.js';

describe('indexing: the worker takes the catalog to ready (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);

  useEmptySearchIndex();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const phase = async (): Promise<string | undefined> => {
    const response = await client().request('status');
    const status = response as { ok: true; result: { phase: string } };
    return status.result.phase;
  };

  const searchMbids = async (query: string, limit = 100): Promise<string[]> => {
    const response = await requestSearch(client(), { query, limit });
    if (!response.ok) {
      throw new Error(`search failed: ${response.error.code}`);
    }
    return response.result.results.map((result) => result.mbid);
  };

  const expectSearchRefused = async (): Promise<void> => {
    const response = await requestSearch(client(), { query: 'tune' });
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'CATALOG_NOT_READY' },
    });
  };

  // A worker that sends two Recordings per task, so a few make several.
  const smallBatchWorker = (signal?: AbortSignal) =>
    createTestWorker(server(), { env: { INDEXING_BATCH_SIZE: '2' }, signal });

  // `count` Recordings of one artist, "Tune 1" to "Tune <count>".
  const addTunes = async (count: number): Promise<string[]> => {
    const artist = await addArtist(server().db, { name: 'Band' });
    const mbids: string[] = [];
    for (let n = 1; n <= count; n++) {
      await addRecording(server().db, {
        mbid: mbid(100 + n),
        name: `Tune ${n}`,
        artists: [{ artist }],
      });
      mbids.push(mbid(100 + n));
    }
    return mbids;
  };

  it('waits for the restore: nothing happens until the phase is restored', async () => {
    await addTunes(2);
    const worker = createTestWorker(server());
    await setBootstrapState(server().db, {
      phase: 'restoring',
      dataset: 'tiny',
    });

    await worker.tick();

    expect(await phase()).toBe('restoring');
  });

  it('indexes everything once the restore is done, then the catalog is ready and searchable', async () => {
    const tunes = await addTunes(5);
    expect(await phase()).toBe('restoring');

    await indexCatalog(server(), smallBatchWorker());

    expect(await phase()).toBe('ready');
    expect([...(await searchMbids('tune'))].sort()).toEqual(tunes);
  });

  it('sets the index up by itself: searchable attributes in ranking order, everything else at its default', async () => {
    await indexCatalog(server());

    expect(await meilisearchSettings()).toMatchObject({
      searchableAttributes: [
        'title',
        'artistCredit',
        'artistAliases',
        'releaseTitles',
        'workTitles',
        'genres',
        'disambiguation',
      ],
      pagination: { maxTotalHits: 1000 },
      // Left alone, so a typo or a word cut short still finds the Recording.
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
      },
      prefixSearch: 'indexingTime',
    });
  });

  it('makes a catalog with no Recording ready', async () => {
    await indexCatalog(server());

    expect(await phase()).toBe('ready');
    expect(await searchMbids('anything')).toEqual([]);
  });

  it('syncs a Recording added after the catalog is ready', async () => {
    await addTunes(2);
    await indexCatalog(server());
    const upsert = vi.spyOn(MeilisearchIndex.prototype, 'upsert');
    await addRecording(server().db, { mbid: mbid(200), name: 'Newcomer' });

    await createTestWorker(server()).tick();

    expect(upsert).toHaveBeenCalled();
    expect(await searchMbids('newcomer')).toContain(mbid(200));
  });

  // What the worker sends to Meilisearch, batch by batch; `beforeSend` may
  // throw to play a worker that dies at that point.
  const watchUpserts = (
    beforeSend: (call: number) => void = () => undefined,
  ) => {
    const original = MeilisearchIndex.prototype.upsert;
    const sent: string[][] = [];
    vi.spyOn(MeilisearchIndex.prototype, 'upsert').mockImplementation(
      async function (this: MeilisearchIndex<never>, documents) {
        beforeSend(sent.length + 1);
        sent.push(documents.map((document) => String(document.mbid)));
        await original.call(this, documents);
      },
    );
    return sent;
  };

  it('stops after the batch in progress when asked to, leaving the catalog not ready', async () => {
    await addTunes(6);
    const controller = new AbortController();
    const sent = watchUpserts((call) => {
      if (call === 2) {
        controller.abort();
      }
    });
    const worker = smallBatchWorker(controller.signal);

    await indexCatalog(server(), worker);

    expect(sent).toHaveLength(2);
    expect(await phase()).toBe('indexing');
    await expectSearchRefused();
  });

  describe('when the worker dies in the middle of indexing', () => {
    it('logs cumulative confirmed counts after restarting with gaps in the source ids', async () => {
      const removed = await addRecording(server().db, { name: 'Removed' });
      await deleteRecording(server().db, removed);
      const tunes = await addTunes(5);
      const controller = new AbortController();
      watchUpserts((call) => {
        if (call === 1) controller.abort();
      });
      await indexCatalog(server(), smallBatchWorker(controller.signal));
      expect(await phase()).toBe('indexing');
      vi.restoreAllMocks();
      const logs = vi.spyOn(testLogger, 'info');

      await smallBatchWorker().tick();

      expect(logs).toHaveBeenCalledWith('Indexed a batch of Recordings', {
        batch: 1,
        indexed: 4,
        remaining: 1,
        total: 5,
        percent: 80,
        lastRecordingId: 5,
      });
      expect(logs).toHaveBeenCalledWith('Indexed a batch of Recordings', {
        batch: 2,
        indexed: 5,
        remaining: 0,
        total: 5,
        percent: 100,
        lastRecordingId: 6,
      });
      expect(await phase()).toBe('ready');
      await server().waitForSearchPhase('ready');
      expect([...(await searchMbids('tune'))].sort()).toEqual(tunes);
    });

    const killedAfterTwoBatches = async () => {
      const tunes = await addTunes(5);
      const sent = watchUpserts((call) => {
        if (call === 3) {
          throw new Error('the worker was killed');
        }
      });
      const worker = smallBatchWorker();
      await expect(indexCatalog(server(), worker)).rejects.toThrow('killed');
      vi.restoreAllMocks();
      return { tunes, sentBeforeDeath: sent };
    };

    it('stays in the indexing phase, not searchable yet', async () => {
      await killedAfterTwoBatches();

      expect(await phase()).toBe('indexing');
      await expectSearchRefused();
    });

    it('resumes from the last batch Meilisearch confirmed instead of starting over', async () => {
      const { tunes, sentBeforeDeath } = await killedAfterTwoBatches();
      expect(sentBeforeDeath).toEqual([tunes.slice(0, 2), tunes.slice(2, 4)]);
      const sent = watchUpserts();

      // A new process: a worker built from scratch finds the work half done.
      await smallBatchWorker().tick();

      expect(sent).toEqual([tunes.slice(4)]);
      expect(await phase()).toBe('ready');
      await server().waitForSearchPhase('ready');
      expect([...(await searchMbids('tune'))].sort()).toEqual(tunes);
    });

    it('sends the batch again when it died before its checkpoint was written', async () => {
      const tunes = await addTunes(4);
      const failing = vi
        .spyOn(MeilisearchIndex.prototype, 'upsert')
        .mockRejectedValueOnce(new Error('killed before the first batch'));
      const worker = smallBatchWorker();
      await expect(indexCatalog(server(), worker)).rejects.toThrow('killed');
      failing.mockRestore();
      const sent = watchUpserts();

      await smallBatchWorker().tick();

      expect(sent).toEqual([tunes.slice(0, 2), tunes.slice(2)]);
      expect(await phase()).toBe('ready');
    });
  });
});

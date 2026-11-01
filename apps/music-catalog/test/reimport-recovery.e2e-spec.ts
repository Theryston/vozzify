import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import type { Database } from '../src/database/database.js';
import { MbslaveClient } from '../src/integrations/mbslave/mbslave-client.js';
import {
  createMeilisearchIndex,
  type MeilisearchIndex,
} from '../src/integrations/meilisearch/meilisearch-index.js';
import {
  RECORDINGS_INDEX,
  RECORDINGS_NEXT_INDEX,
  type RecordingDocument,
} from '../src/lib/recordings-index.js';
import {
  REIMPORT_GENERATION_INDEX,
  REIMPORT_GENERATION_NEXT_INDEX,
  type ReimportGenerationDocument,
} from '../src/lib/reimport-generation-index.js';
import { BootstrapRepository } from '../src/modules/bootstrap/bootstrap.repository.js';
import { BootstrapService } from '../src/modules/bootstrap/bootstrap.service.js';
import { RestoreService } from '../src/modules/bootstrap/restore.service.js';
import { ReimportRestoreService } from '../src/modules/reimport/reimport-restore.service.js';
import { ReimportStateRepository } from '../src/modules/reimport/reimport-state.repository.js';
import {
  ReimportSwitchService,
  type SwitchIndex,
} from '../src/modules/reimport/reimport-switch.service.js';
import { ReplicationRepository } from '../src/modules/replication/replication.repository.js';
import { RecordingOutboxRepository } from '../src/modules/sync/recording-outbox.repository.js';
import { applyMusicBrainzSchema } from './setup/musicbrainz-schema.js';
import { testLogger } from './utils/create-test-server.js';
import { setBootstrapState, setReplicationControl } from './utils/database.js';
import { useIsolatedServer } from './utils/isolated-server.js';
import { meilisearchRequest } from './utils/meilisearch-http.js';
import { addRecording, mbid } from './utils/musicbrainz.js';
import { useReimportFlow } from './utils/reimport-flows.js';
import {
  replicationWith,
  seedNewDump,
  stallReplication,
  useCleanParallelCopy,
  useFakeDumps,
  useParallelDatabase,
} from './utils/reimport-harness.js';
import { createTestWorker, useEmptySearchIndex } from './utils/test-worker.js';
import { requestTrackAssociation } from './utils/track-association-client.js';

// The yearly schema change: recovering from an interrupted reimport (see
// test/utils/reimport-harness.ts for the shared setup and the faked
// boundaries).
describe('yearly schema change: recovering an interrupted reimport (e2e)', {
  timeout: 120_000,
}, () => {
  // One server per test (not per file): a switch test flips its process to
  // the parallel database, and the next test must read the serving copy
  // again. Booting per test is what keeps the adoption honest.
  const { server, client } = useIsolatedServer();

  useEmptySearchIndex();

  const parallel = useParallelDatabase();
  useCleanParallelCopy(parallel);
  const dumps = useFakeDumps();
  const { statusResult, searchMbids, serveCatalog, restoreParallel } =
    useReimportFlow({ server, client, parallel, dumps });

  // The flip below, wired like the worker does (single-task swap, exact
  // generation marker, flip record), against the real databases and Meili.
  // The retired database is never dropped here: the shared e2e database
  // serves these suites, and the default cleanup has its own suite.
  const flipWith = (fail: { deletes?: boolean; marks?: boolean } = {}) => {
    const meilisearch = inject('meilisearch');
    const recordingIndex = createMeilisearchIndex<RecordingDocument>({
      url: meilisearch.url,
      apiKey: meilisearch.writeKey,
      ...RECORDINGS_INDEX,
    });
    const nextRecordingIndex = createMeilisearchIndex<RecordingDocument>({
      url: meilisearch.url,
      apiKey: meilisearch.writeKey,
      ...RECORDINGS_NEXT_INDEX,
    });
    const servingGenerationIndex =
      createMeilisearchIndex<ReimportGenerationDocument>({
        url: meilisearch.url,
        apiKey: meilisearch.writeKey,
        ...REIMPORT_GENERATION_INDEX,
      });
    const nextGenerationIndex =
      createMeilisearchIndex<ReimportGenerationDocument>({
        url: meilisearch.url,
        apiKey: meilisearch.writeKey,
        ...REIMPORT_GENERATION_NEXT_INDEX,
      });
    const delegate = (
      index: MeilisearchIndex<RecordingDocument>,
      failDelete: boolean,
    ): SwitchIndex => {
      let deleteFailed = false;
      return {
        deleteIndex: async () => {
          if (failDelete && fail.deletes === true && !deleteFailed) {
            deleteFailed = true;
            throw new Error('container lost mid-flip');
          }
          await index.deleteIndex();
        },
      };
    };
    let swaps = 0;
    const service = new ReimportSwitchService({
      servingOutbox: new RecordingOutboxRepository(server().db),
      servingState:
        fail.marks === true
          ? {
              markSwitched: async (): Promise<void> => {
                throw new Error('container lost mid-flip');
              },
              dropDatabase: async (): Promise<void> => undefined,
            }
          : new ReimportStateRepository(server().db),
      nextState: new ReimportStateRepository(parallel().db),
      sequences: new ReplicationRepository(server().db),
      nextIndex: delegate(nextRecordingIndex, true),
      generation: {
        serving: async () => {
          const marker = await servingGenerationIndex.getDocument('catalog');
          if (marker === undefined) {
            throw new Error('The serving generation marker was missing.');
          }
          return marker.databaseOid;
        },
        next: () => databaseOid(parallel().db),
        deleteNext: () => nextGenerationIndex.deleteIndex(),
      },
      nextUrl: parallel().url,
      oldDatabaseName: undefined,
      cleanupOldCopy: true,
      swapBoth: async () => {
        swaps += 1;
        await recordingIndex.swapPairs([
          {
            servingUid: RECORDINGS_INDEX.uid,
            nextUid: RECORDINGS_NEXT_INDEX.uid,
          },
          {
            servingUid: REIMPORT_GENERATION_INDEX.uid,
            nextUid: REIMPORT_GENERATION_NEXT_INDEX.uid,
          },
        ]);
      },
      alreadySwitched: async () => {
        const state = await new ReimportStateRepository(server().db).get();
        return state?.phase === 'switched' && state.detail === parallel().url;
      },
      logger: testLogger,
    });
    return { run: () => service.switchToCopy(), swaps: () => swaps };
  };

  it('resumes a worker restarted mid-reimport on the parallel copy', async () => {
    const worker = await serveCatalog();
    await requestTrackAssociation(client(), {
      mbid: mbid(901),
      trackId: '00000000-0000-4000-8000-000000000401',
      businessScore: 8,
      revision: 1,
    });
    await restoreParallel(seedNewDump);

    // The crash: the first worker indexes and never comes back.
    await worker.tick();
    await expect(statusResult()).resolves.toMatchObject({
      reimport: { phase: 'switching' },
    });

    // The restart replays the switch idempotently and finishes the flip.
    const restarted = createTestWorker(server(), {
      env: {
        CATALOG_DATASET: 'full',
        REIMPORT_CLEANUP_OLD_COPY: 'false',
      },
      nextCopy: { db: parallel().db, url: parallel().url },
    });
    await restarted.tick();
    await statusResult();

    await expect(searchMbids('Brand New Next Song')).resolves.toEqual([
      mbid(903),
    ]);
    await expect(statusResult()).resolves.not.toHaveProperty('reimport');
    const indexed = await meilisearchRequest(
      inject('meilisearch'),
      'GET',
      `/indexes/recordings/documents/${mbid(901)}`,
    );
    expect(indexed.json).toMatchObject({
      trackId: '00000000-0000-4000-8000-000000000401',
      businessScore: 8,
    });
  });

  it('redoes a container run lost mid-restore without touching serving', async () => {
    const db = server().db;
    await addRecording(db, {
      mbid: mbid(921),
      name: 'Serving Survivor Song',
      lengthMs: 180_000,
    });
    await setBootstrapState(db, { phase: 'ready', dataset: 'full' });
    await setReplicationControl(db, 199_999);
    await stallReplication(db);
    let attempts = 0;
    const flaky = new ReimportRestoreService({
      bootstrap: new BootstrapService(new BootstrapRepository(db), 'full'),
      replication: replicationWith(db, async () => undefined),
      state: new ReimportStateRepository(db),
      nextState: {
        getState: () => new BootstrapRepository(parallel().db).getState(),
      },
      restore: new RestoreService({
        repository: new BootstrapRepository(parallel().db),
        mbslave: new MbslaveClient(async (args) => {
          if (args[0] === 'init') {
            await applyMusicBrainzSchema(parallel().url);
            return;
          }
          attempts += 1;
          if (attempts === 1) {
            await addRecording(parallel().db, {
              mbid: mbid(922),
              name: 'Half Restored Song',
              lengthMs: 180_000,
            });
            throw new Error('container lost mid-restore');
          }
          await seedNewDump(parallel().db);
        }),
        resolveUrls: async () => ['http://fake/mbdump.tar.bz2'],
        resolveTotalBytes: async () => undefined,
        seedTiny: async () => 0,
        baseUrl: 'http://fake/',
        dataset: 'full',
        logger: testLogger,
      }),
      currentMbslaveRef: 'v32.0.0',
      servingDatabaseUrl: inject('databaseUrl'),
      nextDatabaseUrl: parallel().url,
      dataset: 'full',
      logger: testLogger,
    });

    await expect(flaky.maybeRestore()).rejects.toThrow(
      'container lost mid-restore',
    );
    await expect(flaky.maybeRestore()).resolves.toBe('restored');

    // Redone from a clean state: the half-restored Recording is gone, the
    // new dump stands complete, and the serving copy never noticed.
    const copied = await parallel().db.execute<{ count: string }>(
      sql`select count(*) as count from musicbrainz.recording where gid = ${mbid(922)}`,
    );
    expect(Number(copied.rows[0]?.count)).toBe(0);
    const kept = await new ReimportStateRepository(db).get();
    expect(kept).toMatchObject({ phase: 'indexing' });
  });

  it('completes a flip lost after the swap instead of swapping back', async () => {
    const worker = await serveCatalog();
    await restoreParallel(seedNewDump);
    await worker.tick();
    await expect(statusResult()).resolves.toMatchObject({
      reimport: { phase: 'switching' },
    });

    // The crash: the flip swapped and recorded, then died on the deletes.
    const crashed = flipWith({ deletes: true });
    await expect(crashed.run()).rejects.toThrow('container lost mid-flip');

    // The rerun finds the flip record, skips the swap and finishes: the
    // single swap ran exactly once across both attempts.
    const rerun = flipWith();
    await rerun.run();
    expect(crashed.swaps() + rerun.swaps()).toBe(1);

    // The continuing worker adopts the new copy and finishes the first
    // import's phases on it, like the production tick after the flip.
    const restarted = createTestWorker(server(), {
      env: { CATALOG_DATASET: 'full' },
      nextCopy: { db: parallel().db, url: parallel().url },
    });
    await restarted.tick();
    await statusResult();

    await expect(searchMbids('Brand New Next Song')).resolves.toEqual([
      mbid(903),
    ]);
    await expect(statusResult()).resolves.not.toHaveProperty('reimport');
    const meilisearch = inject('meilisearch');
    await expect(
      meilisearchRequest(meilisearch, 'GET', '/indexes/recordings_next').then(
        ({ status }) => status,
      ),
    ).resolves.toBe(404);
  });

  it('skips the swap when the flip record is missing but the copy is swapped', async () => {
    const worker = await serveCatalog();
    await restoreParallel(seedNewDump);
    // The new dump downloaded over real HTTP from the fake dump server:
    // the URL selection (`LATEST` plus archives) ran against it.
    expect(
      dumps()
        .requested.filter((path) => path.includes('/fullexport/'))
        .join(' '),
    ).toContain('LATEST');
    await worker.tick();
    await expect(statusResult()).resolves.toMatchObject({
      reimport: { phase: 'switching' },
    });

    // The crash: the flip swapped, then died before recording it.
    const crashed = flipWith({ marks: true });
    await expect(crashed.run()).rejects.toThrow('container lost mid-flip');

    // The rerun finds the target database OID in the active marker and
    // completes the flip instead of swapping back: the swap ran exactly once.
    const rerun = flipWith();
    await rerun.run();
    expect(crashed.swaps() + rerun.swaps()).toBe(1);

    // The continuing worker adopts the new copy and finishes the first
    // import's phases on it, like the production tick after the flip.
    const restarted = createTestWorker(server(), {
      env: { CATALOG_DATASET: 'full' },
      nextCopy: { db: parallel().db, url: parallel().url },
    });
    await restarted.tick();
    await statusResult();

    await expect(searchMbids('Brand New Next Song')).resolves.toEqual([
      mbid(903),
    ]);
    const serving = await new ReimportStateRepository(server().db).get();
    expect(serving).toMatchObject({
      phase: 'switched',
      detail: parallel().url,
    });
  });
});

const databaseOid = async (db: Database): Promise<string> => {
  const result = await db.execute<{ databaseOid: string }>(sql`
    select oid::text as "databaseOid"
    from pg_database
    where datname = current_database()
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('Database identity was missing.');
  }
  return row.databaseOid;
};

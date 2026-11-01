import { eq } from 'drizzle-orm';
import { inject } from 'vitest';
import { trackAssociation } from '../src/database/schema/track-association.js';
import { ReimportStateRepository } from '../src/modules/reimport/reimport-state.repository.js';
import { requestRecording } from './utils/get-recording-client.js';
import { useIsolatedServer } from './utils/isolated-server.js';
import { meilisearchRequest } from './utils/meilisearch-http.js';
import { addRecording, mbid } from './utils/musicbrainz.js';
import { useReimportFlow } from './utils/reimport-flows.js';
import {
  seedNewDump,
  useCleanParallelCopy,
  useFakeDumps,
  useParallelDatabase,
} from './utils/reimport-harness.js';
import { requestSearch } from './utils/search-client.js';
import { useEmptySearchIndex } from './utils/test-worker.js';
import { requestTrackAssociation } from './utils/track-association-client.js';

// The yearly schema change: the flip to the parallel copy (see
// test/utils/reimport-harness.ts for the shared setup and the faked
// boundaries).
describe('yearly schema change: switching to the parallel copy (e2e)', {
  timeout: 120_000,
}, () => {
  // One server per test (not per file): a switch test flips its process to
  // the parallel database, and the next test must read the serving copy
  // again. Booting per test is what keeps the adoption honest.
  const parallel = useParallelDatabase();
  const { server, client } = useIsolatedServer(parallel);

  useEmptySearchIndex();

  useCleanParallelCopy(parallel);
  const dumps = useFakeDumps();
  const { statusResult, searchMbids, serveCatalog, restoreParallel } =
    useReimportFlow({ server, client, parallel, dumps });

  it('switches atomically, deletes the old copy and cuts the reads over', async () => {
    const worker = await serveCatalog();
    const overlappingMbids = Array.from({ length: 200 }, (_, index) =>
      mbid(2000 + index),
    );
    for (const [index, recordingMbid] of overlappingMbids.entries()) {
      await addRecording(server().db, {
        mbid: recordingMbid,
        name: `Overlap Song ${index}`,
        lengthMs: 180_000,
      });
    }
    await worker.tick();
    const beforeCopyTrack = '00000000-0000-4000-8000-000000000201';
    const duringCopyTrack = '00000000-0000-4000-8000-000000000202';
    const afterCopyTrack = '00000000-0000-4000-8000-000000000203';
    await requestTrackAssociation(client(), {
      mbid: mbid(901),
      trackId: beforeCopyTrack,
      businessScore: 5,
      revision: 1,
    });
    await restoreParallel(async (db) => {
      for (const [index, recordingMbid] of overlappingMbids.entries()) {
        await addRecording(db, {
          mbid: recordingMbid,
          name: `Overlap Song ${index}`,
          lengthMs: 180_000,
        });
      }
      await seedNewDump(db);
      await addRecording(db, {
        mbid: mbid(2200),
        name: 'Beyond Probe Song',
        lengthMs: 180_000,
      });
    });
    await requestTrackAssociation(client(), {
      mbid: mbid(903),
      trackId: duringCopyTrack,
    });
    const beyondProbeTrack = '00000000-0000-4000-8000-000000000220';
    await requestTrackAssociation(client(), {
      mbid: mbid(2200),
      trackId: beyondProbeTrack,
    });
    await worker.tick();
    const meilisearch = inject('meilisearch');
    await expect(
      client().request('associateTrack', {
        mbid: mbid(904),
        trackId: afterCopyTrack,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'REIMPORT_SWITCHING' },
    });
    await parallel()
      .db.update(trackAssociation)
      .set({ pending: true, indexedRevision: 0 })
      .where(eq(trackAssociation.recordingMbid, mbid(901)));
    await meilisearchRequest(
      meilisearch,
      'PUT',
      '/indexes/recordings_next/settings/ranking-rules',
      [
        'words',
        'typo',
        'proximity',
        'attributeRank',
        'sort',
        'wordPosition',
        'exactness',
      ],
    );
    await meilisearchRequest(
      meilisearch,
      'PUT',
      '/indexes/recordings_next/documents',
      [
        {
          mbid: mbid(901),
          title: 'Same Take Song',
          artistCredit: 'Artist of Same Take Song',
          artistAliases: [],
          releaseTitles: [],
          workTitles: [],
          genres: [],
          disambiguation: '',
          primaryReleaseMbid: null,
          trackId: beforeCopyTrack,
        },
      ],
    );
    await worker.tick();
    const switchedDocument = await meilisearchRequest(
      meilisearch,
      'GET',
      `/indexes/recordings/documents/${mbid(901)}`,
    );
    expect(switchedDocument.json).toMatchObject({
      trackId: beforeCopyTrack,
      businessScore: 5,
    });
    const switchedSettings = await meilisearchRequest(
      meilisearch,
      'GET',
      '/indexes/recordings/settings',
    );
    expect(switchedSettings.json).toMatchObject({
      rankingRules: [
        'words',
        'typo',
        'businessScore:desc',
        'proximity',
        'attributeRank',
        'sort',
        'wordPosition',
        'exactness',
      ],
    });

    // The flip is steady state: no reimport is reported anymore, and one
    // `status` lets the server adopt the new copy without restarting.
    await expect(statusResult()).resolves.toMatchObject({ phase: 'ready' });
    const result = await statusResult();
    expect(result).not.toHaveProperty('reimport');

    // Atomic from the client's point of view: one search answers the new
    // copy wholesale, and the new Recording resolves through `getRecording`
    // (which reads Postgres, so this proves the cutover, not just the swap).
    await expect(searchMbids('Brand New Next Song')).resolves.toEqual([
      mbid(903),
    ]);
    await expect(
      requestSearch(client(), { query: 'Same Take Song' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ mbid: mbid(901), trackId: beforeCopyTrack }] },
    });
    await expect(
      requestSearch(client(), { query: 'Brand New Next Song' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ mbid: mbid(903), trackId: duringCopyTrack }] },
    });
    await expect(
      requestSearch(client(), { query: 'Beyond Probe Song' }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        results: [{ mbid: mbid(2200), trackId: beyondProbeTrack }],
      },
    });

    await requestTrackAssociation(client(), {
      mbid: mbid(904),
      trackId: afterCopyTrack,
    });
    await worker.tick();
    await expect(
      requestSearch(client(), { query: 'Steady Control Song' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ mbid: mbid(904), trackId: afterCopyTrack }] },
    });
    const recording = await requestRecording(client(), { mbid: mbid(903) });
    expect(recording).toMatchObject({ ok: true });
    if (recording.ok) {
      expect(recording.result.title).toBe('Brand New Next Song');
    }

    // The old copy is deleted: the `*_next` index is gone, the stale
    // backlog is dropped, and the flip record names the new database on
    // both copies.
    await expect(
      meilisearchRequest(meilisearch, 'GET', '/indexes/recordings_next').then(
        ({ status }) => status,
      ),
    ).resolves.toBe(404);
    await expect(statusResult()).resolves.toMatchObject({ pendingOutbox: 0 });
    const serving = await new ReimportStateRepository(server().db).get();
    expect(serving).toMatchObject({
      phase: 'switched',
      detail: parallel().url,
    });
    const parallelState = await new ReimportStateRepository(
      parallel().db,
    ).get();
    expect(parallelState).toMatchObject({
      phase: 'switched',
      detail: parallel().url,
    });
  });
});

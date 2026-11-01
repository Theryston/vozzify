import { eq, sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { indexingCheckpoint } from '../src/database/schema/indexing-checkpoint.js';
import { trackAssociation } from '../src/database/schema/track-association.js';
import { MeilisearchIndex } from '../src/integrations/meilisearch/meilisearch-index.js';
import { RECORDINGS_INDEX } from '../src/lib/recordings-index.js';
import { useTestServer } from './utils/create-test-server.js';
import { waitForCatalogWriteLockWaiter } from './utils/database.js';
import { meilisearchRequest } from './utils/meilisearch-http.js';
import { addArtist, addRecording, mbid } from './utils/musicbrainz.js';
import { requestSearch } from './utils/search-client.js';
import {
  createTestWorker,
  indexCatalog,
  useEmptySearchIndex,
} from './utils/test-worker.js';
import { requestTrackAssociation } from './utils/track-association-client.js';
import { useTestClient } from './utils/use-test-client.js';
import { openClient } from './utils/ws-client.js';

const TRACK_A = '00000000-0000-4000-8000-000000000101';
const TRACK_B = '00000000-0000-4000-8000-000000000102';

describe('Track association projection (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);

  useEmptySearchIndex();

  it('acknowledges duplicates and replacements, then searches the latest complete document', async () => {
    const artist = await addArtist(server().db, { name: 'Band' });
    const recording = await addRecording(server().db, {
      mbid: mbid(501),
      name: 'Association Song',
      artists: [{ artist }],
    });
    await indexCatalog(server());

    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_A,
    });
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_A,
    });
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_B,
    });
    await createTestWorker(server()).tick();

    const response = await requestSearch(client(), {
      query: 'Association Song',
    });
    expect(response).toMatchObject({
      ok: true,
      result: { results: [{ mbid: recording.mbid, trackId: TRACK_B }] },
    });
    const meilisearch = inject('meilisearch');
    const document = await meilisearchRequest(
      meilisearch,
      'GET',
      `/indexes/recordings/documents/${recording.mbid}`,
    );
    expect(document.json).toMatchObject({
      mbid: recording.mbid,
      title: 'Association Song',
      trackId: TRACK_B,
      artistCredit: 'Band',
    });
    const idSearch = await requestSearch(client(), { query: TRACK_B });
    expect(idSearch).toMatchObject({ ok: true, result: { results: [] } });
  });

  it('ignores out-of-order scores and keeps an unlink at its newest revision', async () => {
    const artist = await addArtist(server().db, { name: 'Revision Band' });
    const recording = await addRecording(server().db, {
      mbid: mbid(523),
      name: 'Revision Song',
      artists: [{ artist }],
    });
    await indexCatalog(server());

    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_A,
      businessScore: 9,
      revision: 2,
    });
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_B,
      businessScore: 30,
      revision: 1,
    });
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_B,
      businessScore: 30,
      revision: 2,
    });
    await createTestWorker(server()).tick();
    const indexed = await meilisearchRequest(
      inject('meilisearch'),
      'GET',
      `/indexes/recordings/documents/${recording.mbid}`,
    );
    expect(indexed.json).toMatchObject({ trackId: TRACK_A, businessScore: 9 });

    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: null,
      businessScore: null,
      revision: 3,
    });
    await createTestWorker(server()).tick();
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_B,
      businessScore: 30,
      revision: 1,
    });
    await createTestWorker(server()).tick();

    const unlinked = await meilisearchRequest(
      inject('meilisearch'),
      'GET',
      `/indexes/recordings/documents/${recording.mbid}`,
    );
    expect(unlinked.json).toMatchObject({ trackId: null, businessScore: null });
  });

  it('keeps an association for a missing Recording until indexing creates a full document, including after worker restart', async () => {
    await indexCatalog(server());
    const recordingMbid = mbid(502);
    await requestTrackAssociation(client(), {
      mbid: recordingMbid,
      trackId: TRACK_A,
    });

    const restartedWorker = createTestWorker(server());
    await restartedWorker.tick();
    const before = await requestSearch(client(), { query: 'Later Song' });
    expect(before).toMatchObject({ ok: true, result: { results: [] } });
    const meilisearch = inject('meilisearch');
    const missingDocument = await meilisearchRequest(
      meilisearch,
      'GET',
      `/indexes/recordings/documents/${recordingMbid}`,
    );
    expect(missingDocument.status).toBe(404);

    const artist = await addArtist(server().db, { name: 'Later Band' });
    await addRecording(server().db, {
      mbid: recordingMbid,
      name: 'Later Song',
      artists: [{ artist }],
    });
    await restartedWorker.tick();

    const after = await requestSearch(client(), { query: 'Later Song' });
    expect(after).toMatchObject({
      ok: true,
      result: { results: [{ mbid: recordingMbid, trackId: TRACK_A }] },
    });
  });

  it('scans past a lower pending MBID for a missing Recording at batch size one', async () => {
    const artist = await addArtist(server().db, { name: 'Batch Band' });
    const recording = await addRecording(server().db, {
      mbid: mbid(511),
      name: 'Batch Song',
      artists: [{ artist }],
    });
    await indexCatalog(server());
    await requestTrackAssociation(client(), {
      mbid: mbid(510),
      trackId: TRACK_A,
    });
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_B,
    });

    await createTestWorker(server(), {
      env: { INDEXING_BATCH_SIZE: '1' },
    }).tick();

    await expect(
      requestSearch(client(), { query: 'Batch Song' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ mbid: recording.mbid, trackId: TRACK_B }] },
    });
    const missingDocument = await meilisearchRequest(
      inject('meilisearch'),
      'GET',
      `/indexes/recordings/documents/${mbid(510)}`,
    );
    expect(missingDocument.status).toBe(404);
  });

  it('retries an acknowledged association after a Meilisearch write failure and worker restart', async () => {
    const artist = await addArtist(server().db, { name: 'Retry Band' });
    const recording = await addRecording(server().db, {
      mbid: mbid(512),
      name: 'Retry Song',
      artists: [{ artist }],
    });
    await indexCatalog(server());
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_A,
      businessScore: 7,
      revision: 1,
    });

    const updateDocuments = vi
      .spyOn(MeilisearchIndex.prototype, 'updateDocuments')
      .mockRejectedValueOnce(new Error('simulated partial update failure'));
    const failedWorker = createTestWorker(server());
    await expect(failedWorker.tick()).rejects.toThrow(
      'simulated partial update failure',
    );
    expect(updateDocuments).toHaveBeenCalledTimes(1);
    updateDocuments.mockRestore();
    const [pending] = await server()
      .db.select({ pending: trackAssociation.pending })
      .from(trackAssociation)
      .where(eq(trackAssociation.recordingMbid, recording.mbid));
    expect(pending?.pending).toBe(true);

    await createTestWorker(server()).tick();

    await expect(
      requestSearch(client(), { query: 'Retry Song' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ mbid: recording.mbid, trackId: TRACK_A }] },
    });
  });

  it('orders a stale metadata replacement before a concurrent association and retries the complete document', async () => {
    const artist = await addArtist(server().db, { name: 'Race Band' });
    const recording = await addRecording(server().db, {
      mbid: mbid(503),
      name: 'Race Song',
      artists: [{ artist }],
    });
    await indexCatalog(server());
    const meilisearch = inject('meilisearch');
    await server().db.execute(sql`
      update musicbrainz.recording
      set name = 'Race Song Updated'
      where gid = ${recording.mbid}
    `);
    let releaseWrite: () => void = () => undefined;
    let metadataWriteReady: () => void = () => undefined;
    const release = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const metadataWrite = new Promise<void>((resolve) => {
      metadataWriteReady = resolve;
    });
    const originalUpsert = MeilisearchIndex.prototype.upsert;
    const upsert = vi.spyOn(MeilisearchIndex.prototype, 'upsert');
    upsert.mockImplementation(async function <
      Document extends Record<string, unknown>,
    >(this: MeilisearchIndex<Document>, documents: Document[]) {
      if (documents.some((document) => document.mbid === recording.mbid)) {
        metadataWriteReady();
        await release;
      }
      await originalUpsert.call(this, documents);
    });
    try {
      const workerTick = createTestWorker(server()).tick();
      await metadataWrite;
      const delivery = client().request(
        'associateTrack',
        { mbid: recording.mbid, trackId: TRACK_A },
        'metadata-association-race',
      );
      await waitForCatalogWriteLockWaiter(server().db);
      releaseWrite();
      await Promise.all([workerTick, delivery]);
    } finally {
      releaseWrite();
      upsert.mockRestore();
    }

    await expect(
      requestSearch(client(), { query: 'Race Song Updated' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ mbid: recording.mbid, trackId: TRACK_A }] },
    });
    const indexed = await meilisearchRequest(
      meilisearch,
      'GET',
      `/indexes/recordings/documents/${recording.mbid}`,
    );
    expect(indexed.json).toMatchObject({
      trackId: TRACK_A,
      title: 'Race Song Updated',
      artistCredit: 'Race Band',
    });
  });

  it('keeps the Track ID through a full index reconstruction', async () => {
    const artist = await addArtist(server().db, { name: 'Rebuild Band' });
    const recording = await addRecording(server().db, {
      mbid: mbid(504),
      name: 'Rebuild Song',
      artists: [{ artist }],
    });
    await indexCatalog(server());
    await requestTrackAssociation(client(), {
      mbid: recording.mbid,
      trackId: TRACK_B,
    });
    await createTestWorker(server()).tick();

    const meilisearch = inject('meilisearch');
    await meilisearchRequest(meilisearch, 'DELETE', '/indexes/recordings');
    await server()
      .db.delete(indexingCheckpoint)
      .where(eq(indexingCheckpoint.indexUid, RECORDINGS_INDEX.uid));
    await indexCatalog(server());

    await expect(
      requestSearch(client(), { query: 'Rebuild Song' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ mbid: recording.mbid, trackId: TRACK_B }] },
    });
  });

  it('rejects malformed or unauthenticated association delivery', async () => {
    await indexCatalog(server());
    const invalid = await client().request('associateTrack', {
      mbid: 'not-an-mbid',
      trackId: TRACK_A,
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    const invalidScore = await client().request('associateTrack', {
      mbid: mbid(526),
      trackId: TRACK_A,
      businessScore: 0,
      revision: 1,
    });
    expect(invalidScore).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    const invalidPairs = [
      { mbid: mbid(527), trackId: TRACK_A, businessScore: 1 },
      { mbid: mbid(528), trackId: TRACK_A, revision: 1 },
      {
        mbid: mbid(529),
        trackId: TRACK_A,
        businessScore: null,
        revision: 1,
      },
      { mbid: mbid(530), trackId: null, businessScore: 1, revision: 1 },
    ];
    for (const payload of invalidPairs) {
      await expect(
        client().request('associateTrack', payload),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    await expect(
      client().request('associateTrack', {
        mbid: mbid(531),
        trackId: TRACK_A,
      }),
    ).resolves.toMatchObject({ ok: true, result: {} });
    const unauthenticated = await openClient(server().url, {
      key: 'wrong-key',
    });
    expect(unauthenticated).toMatchObject({ opened: false, status: 401 });
  });
});

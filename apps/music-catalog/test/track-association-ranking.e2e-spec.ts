import { inject } from 'vitest';
import { useTestServer } from './utils/create-test-server.js';
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

const TRACK_A = '00000000-0000-4000-8000-000000000101';
const TRACK_B = '00000000-0000-4000-8000-000000000102';

describe('Track association score ranking (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);
  useEmptySearchIndex();

  it('ranks linked Recording variants by absolute business score and preserves the sparse index', async () => {
    const bandA = await addArtist(server().db, { name: 'Original Artist' });
    const bandB = await addArtist(server().db, { name: 'Cover Artist' });
    const original = await addRecording(server().db, {
      mbid: mbid(520),
      name: 'Twin Song',
      artists: [{ artist: bandA }],
    });
    const cover = await addRecording(server().db, {
      mbid: mbid(521),
      name: 'Twin Song',
      artists: [{ artist: bandB }],
    });
    const unlinked = await addRecording(server().db, {
      mbid: mbid(522),
      name: 'Twin Song',
      artists: [{ artist: bandA }],
    });
    const partialMatch = await addRecording(server().db, {
      mbid: mbid(524),
      name: 'Twin',
      artists: [{ artist: bandA }],
    });
    const clearedScore = await addRecording(server().db, {
      mbid: mbid(525),
      name: 'Twin Song',
      artists: [{ artist: bandA }],
    });
    await indexCatalog(server());

    const meilisearch = inject('meilisearch');
    await meilisearchRequest(
      meilisearch,
      'PUT',
      '/indexes/recordings/settings/ranking-rules',
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
      '/indexes/recordings/documents',
      [
        {
          mbid: unlinked.mbid,
          title: 'Twin Song',
          artistCredit: 'Original Artist',
          artistAliases: ['Original Artist'],
          releaseTitles: [],
          workTitles: [],
          genres: [],
          disambiguation: '',
          primaryReleaseMbid: null,
          trackId: null,
        },
      ],
    );
    const before = await meilisearchRequest(
      meilisearch,
      'GET',
      '/indexes/recordings/stats',
    );
    await requestTrackAssociation(client(), {
      mbid: original.mbid,
      trackId: TRACK_A,
      businessScore: 20,
      revision: 1,
    });
    await requestTrackAssociation(client(), {
      mbid: cover.mbid,
      trackId: TRACK_B,
      businessScore: 12,
      revision: 1,
    });
    await requestTrackAssociation(client(), {
      mbid: partialMatch.mbid,
      trackId: TRACK_A,
      businessScore: 100,
      revision: 1,
    });
    await requestTrackAssociation(client(), {
      mbid: clearedScore.mbid,
      trackId: TRACK_B,
      businessScore: 8,
      revision: 1,
    });
    await createTestWorker(server()).tick();
    await requestTrackAssociation(client(), {
      mbid: clearedScore.mbid,
      trackId: null,
      businessScore: null,
      revision: 2,
    });
    await createTestWorker(server()).tick();

    const initial = await requestSearch(client(), { query: 'Twin Song' });
    expect(initial).toMatchObject({
      ok: true,
      result: {
        results: [
          { mbid: original.mbid, trackId: TRACK_A },
          { mbid: cover.mbid, trackId: TRACK_B },
          { mbid: unlinked.mbid, trackId: null },
          { mbid: clearedScore.mbid, trackId: null },
          { mbid: partialMatch.mbid, trackId: TRACK_A },
        ],
      },
    });
    await meilisearchRequest(
      meilisearch,
      'PATCH',
      '/indexes/recordings/documents',
      [{ mbid: original.mbid, businessScore: null }],
    );
    await requestTrackAssociation(client(), {
      mbid: original.mbid,
      trackId: TRACK_A,
      businessScore: 20,
      revision: 1,
    });
    await createTestWorker(server()).tick();
    const repaired = await meilisearchRequest(
      meilisearch,
      'GET',
      `/indexes/recordings/documents/${original.mbid}`,
    );
    expect(repaired.json).toMatchObject({
      trackId: TRACK_A,
      businessScore: 20,
    });
    await requestTrackAssociation(client(), {
      mbid: original.mbid,
      trackId: TRACK_A,
      businessScore: 1,
      revision: 2,
    });
    await createTestWorker(server()).tick();
    const response = await requestSearch(client(), { query: 'Twin Song' });
    expect(response).toMatchObject({
      ok: true,
      result: {
        results: [
          { mbid: cover.mbid, trackId: TRACK_B },
          { mbid: original.mbid, trackId: TRACK_A },
          { mbid: unlinked.mbid, trackId: null },
          { mbid: clearedScore.mbid, trackId: null },
          { mbid: partialMatch.mbid, trackId: TRACK_A },
        ],
      },
    });
    if (!response.ok) throw new Error('Expected search results');
    const decreasedResults = response.result.results;
    const baseScorePosition = decreasedResults.findIndex(
      (item) => item.mbid === original.mbid,
    );
    expect(baseScorePosition).toBeLessThan(
      decreasedResults.findIndex((item) => item.mbid === unlinked.mbid),
    );
    expect(baseScorePosition).toBeLessThan(
      decreasedResults.findIndex((item) => item.mbid === clearedScore.mbid),
    );
    const after = await meilisearchRequest(
      meilisearch,
      'GET',
      '/indexes/recordings/stats',
    );
    expect(after.json.numberOfDocuments).toBe(before.json.numberOfDocuments);
    const patched = await meilisearchRequest(
      meilisearch,
      'GET',
      `/indexes/recordings/documents/${original.mbid}`,
    );
    expect(patched.json).toMatchObject({
      title: 'Twin Song',
      artistCredit: 'Original Artist',
      trackId: TRACK_A,
      businessScore: 1,
    });
  });
});

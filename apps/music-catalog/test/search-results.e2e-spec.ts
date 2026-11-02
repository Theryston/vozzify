import type { RecordingSummary } from '@vozzify/contracts';
import { useTestServer } from './utils/create-test-server.js';
import { requestRecording } from './utils/get-recording-client.js';
import {
  addArtist,
  addRecording,
  deleteRecording,
  mbid,
} from './utils/musicbrainz.js';
import { addRelease, addTrack } from './utils/musicbrainz-relations.js';
import { requestSearch } from './utils/search-client.js';
import {
  createTestWorker,
  indexCatalog,
  meilisearchOrder,
  useEmptySearchIndex,
} from './utils/test-worker.js';
import { useTestClient } from './utils/use-test-client.js';

describe('search: what a result shows and the order of the results (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);

  useEmptySearchIndex();

  const search = async (payload: unknown): Promise<RecordingSummary[]> => {
    const response = await requestSearch(client(), payload);
    if (!response.ok) {
      throw new Error(`search failed: ${response.error.code}`);
    }
    return response.result.results;
  };

  describe('the compact display result', () => {
    it('returns only the displayed fields and the selected release cover', async () => {
      const db = server().db;
      const hall = await addArtist(db, { name: 'Hall', mbid: mbid(11) });
      const oates = await addArtist(db, { name: 'Oates', mbid: mbid(12) });
      const richGirl = await addRecording(db, {
        mbid: mbid(150),
        name: 'Rich Girl',
        artists: [
          { artist: hall, creditedName: 'Daryl Hall', joinPhrase: ' and ' },
          { artist: oates, creditedName: 'John Oates' },
        ],
        lengthMs: 143_000,
        disambiguation: 'album version',
        video: true,
      });
      const album = await addRelease(db, {
        name: 'Bigger Than Both of Us',
        mbid: mbid(350),
        artistCredit: richGirl.artistCredit,
        events: [{ country: 'US', year: 1976, month: 9 }],
      });
      await addTrack(db, { release: album, recording: richGirl });
      await indexCatalog(server());

      const [result] = await search({ query: 'rich girl' });

      expect(result).toEqual({
        mbid: mbid(150),
        title: 'Rich Girl',
        artistCredit: 'Daryl Hall and John Oates',
        coverUrl: `https://assets.vozzify.com/cover-art-archive/release/${mbid(350)}/front-500`,
        trackId: null,
      });
      expect(Object.keys(result ?? {}).sort()).toEqual([
        'artistCredit',
        'coverUrl',
        'mbid',
        'title',
        'trackId',
      ]);
    });

    it('returns a null cover when the Recording has no release', async () => {
      await addRecording(server().db, { mbid: mbid(100), name: 'Untitled' });
      await indexCatalog(server());

      const [result] = await search({ query: 'untitled' });

      expect(result).toEqual({
        mbid: mbid(100),
        title: 'Untitled',
        artistCredit: 'Artist of Untitled',
        coverUrl: null,
        trackId: null,
      });
    });

    it('keeps the same primary release selection as getRecording', async () => {
      const db = server().db;
      const artist = await addArtist(db, { name: 'Band' });
      const song = await addRecording(db, {
        mbid: mbid(100),
        name: 'Song',
        artists: [{ artist }],
      });
      const reissue = await addRelease(db, {
        name: 'Reissue',
        artistCredit: song.artistCredit,
        events: [
          { country: 'GB', year: 1999 },
          { country: 'US', year: 1999, month: 5 },
        ],
      });
      const original = await addRelease(db, {
        name: 'Original',
        artistCredit: song.artistCredit,
        events: [
          { country: 'US', year: 1971, month: 3 },
          { country: 'GB', year: 1971 },
        ],
      });
      const undated = await addRelease(db, {
        name: 'Aardvark (undated)',
        artistCredit: song.artistCredit,
      });
      for (const [position, release] of [
        reissue,
        original,
        undated,
      ].entries()) {
        await addTrack(db, {
          release,
          recording: song,
          position: position + 1,
        });
      }
      await indexCatalog(server());

      const [result] = await search({ query: 'song' });
      const full = await requestRecording(client(), { mbid: mbid(100) });

      if (!full.ok) {
        throw new Error('getRecording failed');
      }
      const listedFirst = full.result.releases[0];
      expect(result?.coverUrl).toBe(
        `https://assets.vozzify.com/cover-art-archive/release/${listedFirst?.mbid}/front-500`,
      );
    });

    it('updates the displayed cover when incremental indexing selects a new primary release', async () => {
      const db = server().db;
      const artist = await addArtist(db, { name: 'Band' });
      const song = await addRecording(db, {
        mbid: mbid(100),
        name: 'Song',
        artists: [{ artist }],
      });
      const firstRelease = await addRelease(db, {
        name: 'First release',
        mbid: mbid(400),
        artistCredit: song.artistCredit,
        events: [{ country: 'US', year: 1990 }],
      });
      await addTrack(db, { release: firstRelease, recording: song });
      const worker = createTestWorker(server());
      await indexCatalog(server(), worker);

      await expect(search({ query: 'song' })).resolves.toMatchObject([
        {
          coverUrl: `https://assets.vozzify.com/cover-art-archive/release/${mbid(400)}/front-500`,
        },
      ]);

      const earlierRelease = await addRelease(db, {
        name: 'Earlier release',
        mbid: mbid(401),
        artistCredit: song.artistCredit,
        events: [{ country: 'GB', year: 1970 }],
      });
      await addTrack(db, { release: earlierRelease, recording: song });
      await worker.tick();

      await expect(search({ query: 'song' })).resolves.toMatchObject([
        {
          coverUrl: `https://assets.vozzify.com/cover-art-archive/release/${mbid(401)}/front-500`,
        },
      ]);
    });
  });

  describe('the order and the pages of the results', () => {
    // Inserted in the reverse of their relevance and with MBIDs that sort the
    // same way, so neither the id nor the MBID order can pass for Meilisearch's.
    const arrangeRelevance = async () => {
      const db = server().db;
      const love = await addArtist(db, { name: 'Love', mbid: mbid(1) });
      const band = await addArtist(db, { name: 'Band', mbid: mbid(2) });
      await addRecording(db, {
        mbid: mbid(100),
        name: 'Song',
        artists: [{ artist: band }],
        disambiguation: 'love',
      });
      const byLove = await addRecording(db, {
        mbid: mbid(101),
        name: 'Song',
        artists: [{ artist: love }],
      });
      await addRecording(db, {
        mbid: mbid(102),
        name: 'Love',
        artists: [{ artist: band }],
      });
      await indexCatalog(server());
      return { byLove };
    };

    it("returns the results in exactly Meilisearch's order", async () => {
      await arrangeRelevance();

      const results = await search({ query: 'love' });

      const meilisearchs = await meilisearchOrder('love');
      expect(meilisearchs).toHaveLength(3);
      expect(results.map((r) => r.mbid)).toEqual(meilisearchs);
      // A title beats an artist, which beats a disambiguation: the opposite of
      // the order the rows were written in.
      expect(results.map((r) => r.mbid)).toEqual([
        mbid(102),
        mbid(101),
        mbid(100),
      ]);
    });

    it('serves the indexed page without checking PostgreSQL for stale matches', async () => {
      const { byLove } = await arrangeRelevance();
      // MusicBrainz deleted it after the index was built.
      await deleteRecording(server().db, byLove);

      const results = await search({ query: 'love' });

      expect(results.map((r) => r.mbid)).toEqual([
        mbid(102),
        mbid(101),
        mbid(100),
      ]);
    });

    it('pages through the results with limit and offset', async () => {
      const db = server().db;
      const artist = await addArtist(db, { name: 'Band' });
      for (let n = 1; n <= 5; n++) {
        await addRecording(db, {
          mbid: mbid(100 + n),
          name: `Song number ${n}`,
          artists: [{ artist }],
        });
      }
      await indexCatalog(server());

      const all = await search({ query: 'song number', limit: 5 });
      const pages = [
        await search({ query: 'song number', limit: 2, offset: 0 }),
        await search({ query: 'song number', limit: 2, offset: 2 }),
        await search({ query: 'song number', limit: 2, offset: 4 }),
      ];

      expect(all).toHaveLength(5);
      expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
      expect(pages.flat().map((r) => r.mbid)).toEqual(all.map((r) => r.mbid));
    });

    it('answers an empty page past the last result', async () => {
      await addRecording(server().db, { mbid: mbid(100), name: 'Only song' });
      await indexCatalog(server());

      const results = await search({
        query: 'only song',
        limit: 10,
        offset: 10,
      });

      expect(results).toEqual([]);
    });

    it('answers at most the limit it was given, 20 when none', async () => {
      const db = server().db;
      const artist = await addArtist(db, { name: 'Band' });
      for (let n = 1; n <= 22; n++) {
        await addRecording(db, {
          mbid: mbid(100 + n),
          name: `Tune ${n}`,
          artists: [{ artist }],
        });
      }
      await indexCatalog(server());

      const byDefault = await search({ query: 'tune' });
      const three = await search({ query: 'tune', limit: 3 });

      expect(byDefault).toHaveLength(20);
      expect(three).toHaveLength(3);
    });
  });
});

import { sql } from 'drizzle-orm';
import { useTestServer } from './utils/create-test-server.js';
import { requestRecording } from './utils/get-recording-client.js';
import {
  addArtist,
  addRecording,
  ensureNamed,
  type FixtureRecording,
  mbid,
} from './utils/musicbrainz.js';
import {
  addRelease,
  addSecondaryType,
  addTrack,
  type FixtureRelease,
  type ReleaseInput,
} from './utils/musicbrainz-relations.js';
import { requestSearch } from './utils/search-client.js';
import {
  createTestWorker,
  indexCatalog,
  useEmptySearchIndex,
} from './utils/test-worker.js';
import { useTestClient } from './utils/use-test-client.js';

type CoverReleaseInput = Omit<ReleaseInput, 'artistCredit'> & {
  artistCredit?: number;
  compilation?: boolean;
};

describe('Recording cover selection (e2e)', () => {
  const server = useTestServer();
  const client = useTestClient(server);
  useEmptySearchIndex();

  const assertSelected = async (
    song: FixtureRecording,
    selected: FixtureRelease,
  ): Promise<void> => {
    const full = await requestRecording(client(), { mbid: song.mbid });
    const search = await requestSearch(client(), { query: 'Don’t' });
    if (!full.ok || !search.ok) throw new Error('Catalog request failed');

    expect(full.result.releases[0]?.mbid).toBe(selected.mbid);
    expect(
      search.result.results.find((item) => item.mbid === song.mbid),
    ).toMatchObject({
      coverUrl: `https://assets.vozzify.com/cover-art-archive/release/${selected.mbid}/front-500`,
    });
  };

  const addSongRelease = async (
    song: FixtureRecording,
    input: CoverReleaseInput,
  ): Promise<FixtureRelease> => {
    const { compilation, ...fields } = input;
    const db = server().db;
    const release = await addRelease(db, {
      artistCredit: song.artistCredit,
      status: 'Official',
      ...fields,
    });
    await addTrack(db, { release, recording: song });
    if (compilation) {
      await addSecondaryType(db, release.releaseGroup, 'Compilation');
    }
    return release;
  };

  const indexAndCheck = async (
    song: FixtureRecording,
    selected: FixtureRelease,
  ) => {
    const worker = createTestWorker(server());
    await indexCatalog(server(), worker);
    await assertSelected(song, selected);
    return worker;
  };

  const arrangeArtist = async () => {
    const db = server().db;
    const artist = await addArtist(db, { name: 'Ed Sheeran' });
    const song = await addRecording(db, {
      name: 'Don’t',
      mbid: mbid(100),
      artists: [{ artist }],
    });
    const album = await addSongRelease(song, {
      name: '×',
      mbid: mbid(200),
      events: [{ year: 2014, month: 6, day: 20 }],
    });
    return { artist, song, album };
  };

  const arrangePromotion = async () => {
    const { song, album } = await arrangeArtist();
    const promotion = await addSongRelease(song, {
      name: 'Earlier promotion',
      status: 'Promotion',
      events: [{ year: 2013 }],
    });
    const worker = await indexAndCheck(song, album);
    return { song, promotion, worker };
  };

  it('selects the artist album instead of Bravo Hits 87 with a year-only date', async () => {
    const { song, album } = await arrangeArtist();
    const various = await addRecording(server().db, {
      name: 'Various Artists credit',
    });
    await addSongRelease(song, {
      name: 'Bravo Hits 87',
      artistCredit: various.artistCredit,
      events: [{ year: 2014 }],
      compilation: true,
    });

    await indexAndCheck(song, album);
  });

  it('also avoids an artist-only compilation with an earlier date', async () => {
    const { song, album } = await arrangeArtist();
    await addSongRelease(song, {
      name: 'A greatest hits collection',
      events: [{ year: 2010 }],
      compilation: true,
    });

    await indexAndCheck(song, album);
  });

  it('prefers a complete date over a year-only date among equivalent artist releases', async () => {
    const { song, album } = await arrangeArtist();
    await addSongRelease(song, {
      name: 'A year-only edition',
      events: [{ year: 2014 }],
    });

    await indexAndCheck(song, album);
  });

  it('matches artist identities across different guest credits', async () => {
    const db = server().db;
    const { artist, album } = await arrangeArtist();
    const guest = await addArtist(db, { name: 'Rick Ross' });
    const remix = await addRecording(db, {
      name: 'Don’t (remix)',
      artists: [{ artist, joinPhrase: ' feat. ' }, { artist: guest }],
    });
    await addTrack(db, { release: album, recording: remix, position: 2 });
    const unrelated = await addRecording(db, { name: 'Other artist credit' });
    await addSongRelease(remix, {
      name: 'A release by another artist',
      artistCredit: unrelated.artistCredit,
      events: [{ year: 2010 }],
    });

    await indexAndCheck(remix, album);
  });

  it('uses a confirmed earlier event despite another year-only event on that release', async () => {
    const { song } = await arrangeArtist();
    const earlier = await addSongRelease(song, {
      name: 'Earlier confirmed edition',
      events: [
        { country: 'US', year: 2014 },
        { country: 'GB', year: 2014, month: 1, day: 1 },
      ],
    });

    await indexAndCheck(song, earlier);
    const full = await requestRecording(client(), { mbid: song.mbid });
    if (!full.ok) throw new Error('getRecording failed');
    expect(full.result.releases[0]).toMatchObject({
      date: '2014',
      country: 'US',
    });
  });

  it('keeps a compilation cover when there is no other release', async () => {
    const song = await addRecording(server().db, {
      name: 'Don’t (radio edit)',
    });
    const compilation = await addSongRelease(song, {
      name: 'Radio Hits',
      events: [{ year: 2014 }],
      compilation: true,
    });

    await indexAndCheck(song, compilation);
  });

  it('refreshes search when a release group gains and loses its Compilation type', async () => {
    const db = server().db;
    const { song, album } = await arrangeArtist();
    const earlier = await addSongRelease(song, {
      name: 'Earlier release',
      events: [{ year: 2013 }],
    });
    const worker = await indexAndCheck(song, earlier);

    await addSecondaryType(db, earlier.releaseGroup, 'Compilation');
    await worker.tick();
    await assertSelected(song, album);

    await db.execute(sql`delete from musicbrainz.release_group_secondary_type_join
      where release_group = ${earlier.releaseGroup.id}`);
    await worker.tick();
    await assertSelected(song, earlier);
  });

  it('refreshes search after the release-group artist credit changes', async () => {
    const db = server().db;
    const { song, album } = await arrangeArtist();
    const earlier = await addSongRelease(song, {
      name: 'Earlier artist release',
      events: [{ year: 2013 }],
    });
    const other = await addRecording(db, { name: 'Other artist credit' });
    const worker = await indexAndCheck(song, earlier);

    await db.execute(sql`update musicbrainz.release_group
      set artist_credit = ${other.artistCredit}
      where id = ${earlier.releaseGroup.id}`);
    await worker.tick();
    await assertSelected(song, album);
  });

  it('refreshes search after a release becomes Official', async () => {
    const db = server().db;
    const { song, promotion, worker } = await arrangePromotion();

    const official = await ensureNamed(db, 'release_status', 'Official');
    await db.execute(sql`update musicbrainz.release set status = ${official}
      where id = ${promotion.id}`);
    await worker.tick();
    await assertSelected(song, promotion);
  });

  it('refreshes search when the Compilation type is renamed', async () => {
    const db = server().db;
    const { song, album } = await arrangeArtist();
    const earlier = await addSongRelease(song, {
      name: 'Earlier collection',
      events: [{ year: 2013 }],
      compilation: true,
    });
    const worker = await indexAndCheck(song, album);

    await db.execute(sql`update musicbrainz.release_group_secondary_type
      set name = 'Live' where name = 'Compilation'`);
    await worker.tick();
    await assertSelected(song, earlier);
  });

  it('refreshes search when the Official status is renamed', async () => {
    const db = server().db;
    const { song, promotion, worker } = await arrangePromotion();

    await db.execute(sql`update musicbrainz.release_status
      set name = 'Bootleg' where name = 'Official'`);
    await worker.tick();
    await assertSelected(song, promotion);
  });

  it('refreshes search when a release-group credit gains the Recording artist', async () => {
    const db = server().db;
    const { artist, song, album } = await arrangeArtist();
    const other = await addRecording(db, { name: 'Other artist credit' });
    const earlier = await addSongRelease(song, {
      name: 'Earlier shared release',
      artistCredit: other.artistCredit,
      events: [{ year: 2013 }],
    });
    const worker = await indexAndCheck(song, album);

    await db.execute(sql`update musicbrainz.artist_credit_name
      set artist = ${artist.id}
      where artist_credit = ${other.artistCredit}`);
    await worker.tick();
    await assertSelected(song, earlier);
  });
});

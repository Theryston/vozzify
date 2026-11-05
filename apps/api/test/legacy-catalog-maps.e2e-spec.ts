import { getQueueToken } from '@nestjs/bullmq';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  albums,
  albumTracks,
  legacyAlbumIds,
} from '../src/database/schema/albums.js';
import {
  artists,
  legacyArtistIds,
  trackArtistCreditResolutions,
} from '../src/database/schema/artists.js';
import { legacyRecordingImports } from '../src/database/schema/legacy-recording-imports.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../src/database/schema/legacy-recording-plans.js';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { CoverArtClient } from '../src/integrations/cover-art/cover-art.client.js';
import { LegacyCatalogMapModule } from '../src/modules/legacy-import/legacy-catalog-map.module.js';
import { LegacyCatalogMapService } from '../src/modules/legacy-import/legacy-catalog-map.service.js';
import { LEGACY_IMPORT_ENV } from '../src/modules/legacy-import/legacy-source.repository.js';
import { TrackMetadataService } from '../src/modules/track-metadata/track-metadata.service.js';
import {
  IMPORT_METADATA_JOB,
  TRACK_METADATA_QUEUE,
} from '../src/queue/track-metadata.job.js';
import {
  artistFixture,
  releaseGroupFixture,
} from './utils/catalog-fixtures.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createTrack, testMbid } from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { recordingFixture } from './utils/recording-fixtures.js';
import { createTrackProcessing } from './utils/track-processing-factories.js';

const RECORDING = testMbid(710);
const ARTIST = testMbid(711);
const RESOLVED_ARTIST = testMbid(714);
const UNRESOLVED_CREDIT_ARTIST = testMbid(717);
const ALBUM = testMbid(712);
const UNRELATED_ALBUM = testMbid(715);
const UNRELATED_ALBUM_ARTIST = testMbid(718);
type MetadataJobState = 'waiting' | 'active' | 'failed' | 'completed';

const recordingAnswer = () => ({
  result: recordingFixture({
    mbid: RECORDING,
    artistCredit: {
      name: 'AliasA and Foo',
      artists: [
        {
          mbid: ARTIST,
          name: 'Artist',
          creditedName: 'AliasA',
          joinPhrase: '',
        },
        {
          mbid: UNRESOLVED_CREDIT_ARTIST,
          name: 'Foo',
          creditedName: 'Foo',
          joinPhrase: '',
        },
      ],
    },
    releases: [
      {
        mbid: testMbid(713),
        title: 'Album',
        releaseGroup: { mbid: ALBUM, primaryType: 'Album' },
        status: 'Official',
        date: '2020',
        country: 'US',
        mediumPosition: 1,
        trackPosition: 1,
        coverArtUrl: 'https://example.test/release-cover',
      },
      {
        mbid: testMbid(716),
        title: 'Greatest Hits',
        releaseGroup: { mbid: UNRELATED_ALBUM, primaryType: 'Album' },
        status: 'Official',
        date: '2019',
        country: 'US',
        mediumPosition: 1,
        trackPosition: 1,
        coverArtUrl: 'https://example.test/compilation-cover',
      },
    ],
  }),
});

const artistAnswer = (mbid: string) => {
  if (mbid === ARTIST) {
    return {
      error: {
        code: 'ARTIST_MOVED',
        message: 'Artist identity was merged',
        newMbid: RESOLVED_ARTIST,
      },
    };
  }
  if (mbid === RESOLVED_ARTIST) {
    return {
      result: artistFixture({ mbid: RESOLVED_ARTIST, name: 'Foo' }),
    };
  }
  if (mbid === UNRESOLVED_CREDIT_ARTIST) {
    return {
      error: {
        code: 'ARTIST_NOT_FOUND',
        message: 'The other Foo artist is not in the catalog',
      },
    };
  }
  if (mbid === UNRELATED_ALBUM_ARTIST) {
    return {
      result: artistFixture({
        mbid: UNRELATED_ALBUM_ARTIST,
        name: 'Unrelated',
      }),
    };
  }
  return undefined;
};

const albumAnswer = (mbid: string) => {
  if (mbid === ALBUM) {
    return {
      result: releaseGroupFixture({
        mbid: ALBUM,
        title: 'Album',
        coverArtUrl: '',
        artistCredit: {
          name: 'Foo',
          artists: [
            {
              mbid: RESOLVED_ARTIST,
              name: 'Foo',
              creditedName: 'Foo',
              joinPhrase: '',
            },
          ],
        },
      }),
    };
  }
  if (mbid === UNRELATED_ALBUM) {
    return {
      result: releaseGroupFixture({
        mbid: UNRELATED_ALBUM,
        title: 'Greatest Hits',
        coverArtUrl: '',
        artistCredit: {
          name: 'Unrelated',
          artists: [
            {
              mbid: UNRELATED_ALBUM_ARTIST,
              name: 'Unrelated',
              creditedName: 'Unrelated',
              joinPhrase: '',
            },
          ],
        },
      }),
    };
  }
  return undefined;
};

const catalogAnswer = (
  payload: Record<string, unknown>,
  unavailable: boolean,
) => {
  if (unavailable) {
    return { error: { code: 'CATALOG_NOT_READY', message: 'Catalog offline' } };
  }
  const mbid = String(payload.mbid);
  if (mbid === RECORDING) return recordingAnswer();
  return (
    artistAnswer(mbid) ??
    albumAnswer(mbid) ?? {
      error: {
        code: 'RELEASE_GROUP_NOT_FOUND',
        message: 'No catalog entity',
      },
    }
  );
};

describe('legacy Artist and Album URL maps (e2e)', () => {
  let testApp: TestApp;
  let catalog: FakeMusicCatalog;
  let sourceContainer: StartedPostgreSqlContainer;
  let catalogUnavailable = false;
  const jobStates = new Map<string, MetadataJobState>();
  const addCalls: { name: string; data: unknown; jobId: string }[] = [];
  const metadataQueue = {
    add: async (name: string, data: unknown, options: unknown) => {
      const jobId =
        typeof options === 'object' && options !== null && 'jobId' in options
          ? String(options.jobId)
          : '';
      jobStates.set(jobId, 'waiting');
      addCalls.push({ name, data, jobId });
      return { id: jobId };
    },
    getJob: async (id: string) => {
      if (!jobStates.has(id)) return undefined;
      return {
        getState: async () => jobStates.get(id),
        remove: async () => {
          jobStates.delete(id);
        },
      };
    },
  };

  beforeAll(async () => {
    sourceContainer = await new PostgreSqlContainer(
      'postgres:17-alpine',
    ).start();
    const sourcePool = new Pool({
      connectionString: sourceContainer.getConnectionUri(),
    });
    await sourcePool.query(`
      create table artists (id text primary key, name text not null, yt_id text not null);
      create table albums (id text primary key, name text not null, yt_id text not null);
      insert into artists values
        ('legacy-artist-one', 'AliasA', 'channel-one'),
        ('legacy-artist-two', 'AliasA', 'channel-two'),
        ('legacy-false-artist', 'Foo', 'channel-false'),
        ('legacy-missing-artist', 'Missing', 'channel-missing'),
        ('orphan-artist', 'Orphan', 'channel-orphan');
      insert into albums values
        ('legacy-album-one', 'Album', 'video-one'),
        ('legacy-album-two', 'Album', 'video-two'),
        ('legacy-album-unrelated', 'Greatest Hits', 'video-three'),
        ('orphan-album', 'Orphan record', 'video-orphan');
    `);
    await sourcePool.end();
    catalog = await startFakeMusicCatalog((payload) =>
      catalogAnswer(payload, catalogUnavailable),
    );
    testApp = await createTestApp({
      imports: [LegacyCatalogMapModule],
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 1_000,
      },
      override: (builder) =>
        builder
          .overrideProvider(LEGACY_IMPORT_ENV)
          .useValue({
            NODE_ENV: 'test',
            DATABASE_URL: sourceContainer.getConnectionUri(),
            LEGACY_DATABASE_URL: sourceContainer.getConnectionUri(),
          })
          .overrideProvider(getQueueToken(TRACK_METADATA_QUEUE))
          .useValue(metadataQueue)
          .overrideProvider(CoverArtClient)
          .useValue({ fetchImage: async () => undefined }),
    });
  });

  afterAll(async () => {
    await testApp.close();
    await catalog.close();
    await sourceContainer.stop();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.db);
    jobStates.clear();
    addCalls.splice(0);
    catalogUnavailable = false;
  });

  it('requeues failures, persists metadata completion, maps duplicate IDs, and serves moved reads', async () => {
    await testApp.db.insert(legacyRecordingPlanRuns).values({
      id: 'legacy-recordings-v1',
      sourceDigest: 'fixture-digest',
      sourceTracks: 3,
      status: 'complete',
    });
    const track = await createTrack(testApp.db, {
      recordingMbid: RECORDING,
      artistCredit: [
        { name: 'AliasA', mbid: ARTIST, joinPhrase: ' & ' },
        { name: 'Foo', mbid: UNRESOLVED_CREDIT_ARTIST, joinPhrase: '' },
      ],
    });
    const processing = await createTrackProcessing(testApp.db, track.id, {
      status: 'COMPLETED',
    });
    await testApp.db.insert(legacyRecordingImports).values({
      id: RECORDING,
      sourceDigest: 'fixture-digest',
      trackId: track.id,
      initialProcessingId: processing.id,
      processingId: processing.id,
    });
    const source = (id: string, artistId: string, albumId: string) => ({
      id,
      ytId: `youtube-${id}`,
      title: 'Song',
      durationSeconds: 180,
      duration: '3:00',
      albumId,
      albumName: 'Album',
      albumYtId: 'youtube-album',
      creatorId: 'legacy-user',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      dependentFavorites: 0,
      dependentViews: 0,
      artists: [
        { id: artistId, name: 'AliasA', ytId: 'youtube-artist' },
        { id: 'legacy-false-artist', name: 'Foo', ytId: 'youtube-false' },
        {
          id: 'legacy-missing-artist',
          name: 'Missing',
          ytId: 'youtube-missing',
        },
      ],
    });
    await testApp.db.insert(legacyRecordingPlans).values([
      {
        legacyTrackId: 'legacy-track-one',
        sourceDigest: 'fixture-digest',
        sourceCreatedAt: new Date('2020-01-01T00:00:00Z'),
        sourceCreatorId: 'legacy-user',
        recordingMbid: RECORDING,
        status: 'planned',
        rationale: 'accepted recording evidence',
        source: source(
          'legacy-track-one',
          'legacy-artist-one',
          'legacy-album-one',
        ),
      },
      {
        legacyTrackId: 'legacy-track-two',
        sourceDigest: 'fixture-digest',
        sourceCreatedAt: new Date('2020-01-02T00:00:00Z'),
        sourceCreatorId: 'legacy-user',
        recordingMbid: RECORDING,
        status: 'planned',
        rationale: 'accepted recording evidence',
        source: source(
          'legacy-track-two',
          'legacy-artist-two',
          'legacy-album-two',
        ),
      },
      {
        legacyTrackId: 'legacy-track-three',
        sourceDigest: 'fixture-digest',
        sourceCreatedAt: new Date('2020-01-03T00:00:00Z'),
        sourceCreatorId: 'legacy-user',
        recordingMbid: RECORDING,
        status: 'planned',
        rationale: 'same-title release group with incompatible artist context',
        source: {
          ...source(
            'legacy-track-three',
            'legacy-artist-one',
            'legacy-album-unrelated',
          ),
          albumName: 'Greatest Hits',
        },
      },
    ]);

    const maps = testApp.app.get(LegacyCatalogMapService);
    const first = await maps.reconcile();
    expect(first.artists.pending).toBe(4);
    expect(first.artists.unresolvedItems).toEqual([
      { legacyId: 'orphan-artist', reason: 'no-planned-track' },
    ]);
    expect(first.albums.pending).toBe(3);
    expect(first.albums.unresolvedItems).toEqual([
      { legacyId: 'orphan-album', reason: 'no-planned-track' },
    ]);
    expect(addCalls).toEqual([
      {
        name: IMPORT_METADATA_JOB,
        data: { trackId: track.id },
        jobId: `metadata-${processing.id}`,
      },
    ]);

    // A completed job from before the durable marker must be replayed to
    // establish database state, even while BullMQ still retains that job.
    jobStates.set(`metadata-${processing.id}`, 'completed');
    const replayedOldJob = await maps.reconcile();
    expect(replayedOldJob.artists.pending).toBe(4);
    expect(addCalls).toHaveLength(2);
    expect(jobStates.get(`metadata-${processing.id}`)).toBe('waiting');

    catalogUnavailable = true;
    jobStates.set(`metadata-${processing.id}`, 'active');
    await expect(
      testApp.app.get(TrackMetadataService).run({ trackId: track.id }, false),
    ).rejects.toThrow();
    await testApp.app
      .get(TrackMetadataService)
      .run({ trackId: track.id }, true);
    jobStates.set(`metadata-${processing.id}`, 'failed');
    const failed = await maps.reconcile();
    expect(failed.artists.pendingItems[0]?.reason).toBe(
      'metadata-import-failed',
    );
    expect(addCalls).toHaveLength(3);
    expect(jobStates.get(`metadata-${processing.id}`)).toBe('waiting');
    const [failedProgress] = await testApp.db
      .select({ metadataStatus: legacyRecordingImports.metadataStatus })
      .from(legacyRecordingImports);
    expect(failedProgress?.metadataStatus).toBe('failed');

    catalogUnavailable = false;
    jobStates.set(`metadata-${processing.id}`, 'active');
    await testApp.app
      .get(TrackMetadataService)
      .run({ trackId: track.id }, true);
    jobStates.set(`metadata-${processing.id}`, 'completed');
    const [completedProgress] = await testApp.db
      .select({ metadataStatus: legacyRecordingImports.metadataStatus })
      .from(legacyRecordingImports);
    expect(completedProgress?.metadataStatus).toBe('completed');

    const mapped = await maps.reconcile();
    expect(mapped.artists).toMatchObject({
      mapped: 2,
      unresolved: 3,
      pending: 0,
    });
    expect(mapped.artists.unresolvedItems).toContainEqual({
      legacyId: 'legacy-false-artist',
      reason: 'no-match',
    });
    expect(mapped.albums).toMatchObject({
      mapped: 2,
      unresolved: 2,
      pending: 0,
    });
    expect(mapped.albums.unresolvedItems).toContainEqual({
      legacyId: 'legacy-album-unrelated',
      reason: 'no-match',
    });
    jobStates.delete(`metadata-${processing.id}`);
    await maps.reconcile();
    expect(addCalls).toHaveLength(3);
    expect(await testApp.db.select().from(legacyArtistIds)).toHaveLength(2);
    expect(await testApp.db.select().from(legacyAlbumIds)).toHaveLength(2);
    expect(await testApp.db.select().from(artists)).toHaveLength(2);
    expect(await testApp.db.select().from(albums)).toHaveLength(2);
    expect(await testApp.db.select().from(albumTracks)).toHaveLength(2);
    expect(await testApp.db.select().from(trackProcessings)).toHaveLength(1);
    const [canonicalArtist] = await testApp.db
      .select({ id: artists.id })
      .from(artists)
      .where(eq(artists.mbid, RESOLVED_ARTIST));
    const creditResolutions = await testApp.db
      .select()
      .from(trackArtistCreditResolutions)
      .where(eq(trackArtistCreditResolutions.trackId, track.id));
    expect(creditResolutions).toEqual([
      expect.objectContaining({
        creditMbid: ARTIST,
        artistId: canonicalArtist?.id,
      }),
    ]);

    const [artistMap] = await testApp.db
      .select()
      .from(legacyArtistIds)
      .where(eq(legacyArtistIds.legacyId, 'legacy-artist-one'));
    const [albumMap] = await testApp.db
      .select()
      .from(legacyAlbumIds)
      .where(eq(legacyAlbumIds.legacyId, 'legacy-album-one'));
    await testApp.http
      .get('/v1/artists/legacy-artist-one')
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('RESOURCE_MOVED');
        expect(body.details.id).toBe(artistMap?.artistId);
      });
    await testApp.http
      .get('/v1/albums/legacy-album-one')
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('RESOURCE_MOVED');
        expect(body.details.id).toBe(albumMap?.albumId);
      });
    await testApp.http
      .get('/v1/artists/legacy-missing-artist')
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('NOT_FOUND');
      });
    await testApp.http
      .get('/v1/albums/unmapped-album')
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('NOT_FOUND');
      });
  });
});

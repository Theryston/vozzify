import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { inject } from 'vitest';
import { legacyRecordingImports } from '../src/database/schema/legacy-recording-imports.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../src/database/schema/legacy-recording-plans.js';
import { legacyRelationshipImports } from '../src/database/schema/legacy-relationship-imports.js';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import { trackViews } from '../src/database/schema/track-views.js';
import { legacyTrackIds, tracks } from '../src/database/schema/tracks.js';
import { LegacyRelationshipDomainService } from '../src/modules/legacy-import/legacy-relationship-domain.service.js';
import { LegacyRelationshipImportModule } from '../src/modules/legacy-import/legacy-relationship-import.module.js';
import { LegacyRelationshipImportService } from '../src/modules/legacy-import/legacy-relationship-import.service.js';
import { LegacySourceRepository } from '../src/modules/legacy-import/legacy-source.repository.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createTrack, createUser } from './utils/factories.js';
import { createTrackProcessing } from './utils/track-processing-factories.js';

const SOURCE_SCHEMA = 'legacy_relationship_460_fixture';
const RECORDING_A = '00000000-0000-4000-8000-000000000460';
const RECORDING_B = '00000000-0000-4000-8000-000000000461';
const CREATED_AT = new Date('2020-02-03T04:05:06.000Z');
const UPDATED_AT = new Date('2021-03-04T05:06:07.000Z');

describe('legacy relationship import (e2e)', () => {
  let source: Pool;
  let sourceUrl: string;
  let testApp: TestApp;
  let importer: LegacyRelationshipImportService;

  beforeAll(async () => {
    source = new Pool({ connectionString: inject('databaseUrl') });
    await source.query(`drop schema if exists ${SOURCE_SCHEMA} cascade`);
    await source.query(`create schema ${SOURCE_SCHEMA}`);
    const url = new URL(inject('databaseUrl'));
    url.searchParams.set(
      'options',
      `-c search_path=${SOURCE_SCHEMA} -c timezone=UTC`,
    );
    sourceUrl = url.toString();
    await source.end();
    source = new Pool({ connectionString: sourceUrl });
    const [isolation] = await source
      .query<{ schema: string }>('select current_schema() as schema')
      .then((result) => result.rows);
    if (isolation?.schema !== SOURCE_SCHEMA)
      throw new Error('LEGACY_FIXTURE_SCHEMA_NOT_ISOLATED');
    vi.stubEnv('LEGACY_DATABASE_URL', sourceUrl);
    await createSourceTables();
    testApp = await createTestApp({
      imports: [LegacyRelationshipImportModule],
    });
    importer = testApp.app.get(LegacyRelationshipImportService);
  });

  afterAll(async () => {
    await testApp?.close();
    vi.unstubAllEnvs();
    await source.query(`drop schema if exists ${SOURCE_SCHEMA} cascade`);
    await source.end();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.db);
    await source.query(
      `truncate table user_favorite_tracks, track_views, track_artists, tracks, albums, artists`,
    );
  });

  it('resumes pending maps, preserves dates and anonymous views, and imports before Processing completes', async () => {
    const ada = await createUser(testApp.db, {
      id: 'legacy-ada',
      username: 'ada',
    });
    const queuedTrack = await createTrack(testApp.db, {
      trendingScore: 91,
    });
    const failedTrack = await createTrack(testApp.db, {
      trendingScore: 73,
    });
    await createTrackProcessing(testApp.db, queuedTrack.id);
    const failed = await createTrackProcessing(testApp.db, failedTrack.id, {
      status: 'FAILED',
    });
    await seedLegacyRelations(ada.id);
    const sourceRows = await testApp.app
      .get(LegacySourceRepository)
      .snapshot(async (snapshot) => ({
        favorites: await snapshot.favoritePage(null),
        views: await snapshot.viewPage(null),
      }));
    const expectedFavoriteDate = sourceRows.favorites.find(
      (row) => row.id === 'a-early',
    );
    const expectedViewDate = sourceRows.views.find(
      (row) => row.id === 'view-queued',
    );
    const expectedFailedFavoriteDate = sourceRows.favorites.find(
      (row) => row.id === 'failed-favorite',
    );
    if (
      !expectedFavoriteDate ||
      !expectedFailedFavoriteDate ||
      !expectedViewDate
    )
      throw new Error('LEGACY_RELATIONSHIP_FIXTURE_DATES_MISSING');
    expect(expectedFavoriteDate).toMatchObject({
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
    expect(expectedViewDate).toMatchObject({
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
    const digest = await testApp.app
      .get(LegacySourceRepository)
      .snapshot((snapshot) => snapshot.validateRecordingSource());
    await testApp.db.insert(legacyRecordingPlanRuns).values({
      id: 'legacy-recordings-v1',
      sourceDigest: digest.digest,
      sourceTracks: 4,
      status: 'complete',
    });
    await testApp.db.insert(legacyRecordingPlans).values([
      plan({
        legacyTrackId: 'legacy-a',
        recordingMbid: RECORDING_A,
        digest: digest.digest,
        favorites: 1,
        views: 1,
      }),
      plan({
        legacyTrackId: 'legacy-b',
        recordingMbid: RECORDING_A,
        digest: digest.digest,
        favorites: 2,
        views: 0,
      }),
      plan({
        legacyTrackId: 'legacy-c',
        recordingMbid: RECORDING_B,
        digest: digest.digest,
        favorites: 1,
        views: 1,
      }),
      plan({
        legacyTrackId: 'legacy-skipped',
        recordingMbid: null,
        digest: digest.digest,
        favorites: 1,
        views: 1,
        status: 'skipped',
      }),
    ]);
    await testApp.db.insert(legacyRecordingImports).values([
      {
        id: RECORDING_B,
        sourceDigest: digest.digest,
        trackId: failedTrack.id,
        initialProcessingId: failed.id,
        processingId: failed.id,
      },
    ]);
    await testApp.db.insert(legacyTrackIds).values([
      { legacyId: 'legacy-a', trackId: queuedTrack.id },
      { legacyId: 'legacy-b', trackId: queuedTrack.id },
    ]);

    const pending = await importer.run();
    expect(pending).toMatchObject({
      status: 'incomplete',
      acceptedFavorites: 0,
      errors: ['RELATIONSHIP_MAP_PENDING'],
    });
    expect(await testApp.db.select().from(trackFavorites)).toEqual([]);
    expect(await testApp.db.select().from(trackViews)).toEqual([]);
    const [progress] = await testApp.db
      .select()
      .from(legacyRelationshipImports);
    expect(progress?.lastFavoriteId).toBeNull();

    await testApp.db.insert(legacyTrackIds).values({
      legacyId: 'legacy-c',
      trackId: failedTrack.id,
    });
    const domain = testApp.app.get(LegacyRelationshipDomainService);
    vi.spyOn(domain, 'refreshFavorites').mockRejectedValueOnce(
      new Error('simulated refresh interruption'),
    );
    const interrupted = await importer.run();
    expect(interrupted).toMatchObject({
      status: 'incomplete',
      acceptedFavorites: 4,
      importedFavorites: 2,
      deduplicatedFavorites: 2,
      errors: ['RELATIONSHIP_IMPORT_FAILED'],
    });
    const [partialProgress] = await testApp.db
      .select()
      .from(legacyRelationshipImports);
    expect(partialProgress).toMatchObject({
      lastFavoriteId: 'z-early',
      lastRefreshedFavoriteId: null,
      acceptedFavorites: 4,
      importedFavorites: 2,
      deduplicatedFavorites: 2,
    });
    expect(await testApp.db.select().from(trackFavorites)).toHaveLength(2);
    expect(await testApp.db.select().from(trackViews)).toHaveLength(0);

    const complete = await importer.run();
    expect(complete).toMatchObject({
      status: 'complete',
      acceptedFavorites: 4,
      importedFavorites: 2,
      deduplicatedFavorites: 2,
      importedViews: 2,
      skippedFavorites: 1,
      skippedViews: 1,
      skippedLegacyTracks: [
        { legacyTrackId: 'legacy-skipped', favorites: 1, views: 1 },
      ],
      errors: [],
    });

    const favorites = await testApp.db
      .select()
      .from(trackFavorites)
      .orderBy(trackFavorites.trackId);
    expect(favorites).toHaveLength(2);
    expect(favorites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'a-early',
          userId: ada.id,
          trackId: queuedTrack.id,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        }),
        expect.objectContaining({
          userId: ada.id,
          trackId: failedTrack.id,
          createdAt: new Date('2022-01-01T00:00:00.000Z'),
        }),
      ]),
    );
    const views = await testApp.db.select().from(trackViews);
    expect(views).toHaveLength(2);
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'view-queued',
          trackId: queuedTrack.id,
          userId: ada.id,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
          locale: null,
          clickId: null,
          visitorId: null,
        }),
        expect.objectContaining({
          id: 'view-anonymous',
          trackId: failedTrack.id,
          userId: null,
          createdAt: new Date('2020-02-03T00:00:00.000Z'),
          updatedAt: new Date('2021-03-04T00:00:00.000Z'),
        }),
      ]),
    );
    const [freshQueued] = await testApp.db
      .select()
      .from(tracks)
      .where(eq(tracks.id, queuedTrack.id));
    expect(freshQueued?.trendingScore).toBe(0);
    await testApp.http
      .get('/v1/users/ada/favorites')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    expect(await importer.run()).toMatchObject({
      status: 'complete',
      acceptedFavorites: 4,
      importedFavorites: 2,
      deduplicatedFavorites: 2,
      importedViews: 2,
    });
    expect(await testApp.db.select().from(trackFavorites)).toHaveLength(2);
    expect(await testApp.db.select().from(trackViews)).toHaveLength(2);
  });

  const createSourceTables = async (): Promise<void> => {
    await source.query(
      `create table albums (id text primary key, name text not null, yt_id text not null)`,
    );
    await source.query(
      `create table artists (id text primary key, name text not null, yt_id text not null)`,
    );
    await source.query(`create table tracks (
      id text primary key, yt_id text, title text, duration text,
      duration_seconds integer, album_id text, creator_id text not null,
      created_at timestamp not null, updated_at timestamp not null
    )`);
    await source.query(`create table track_artists (
      id text primary key, artist_id text not null, track_id text not null
    )`);
    await source.query(`create table user_favorite_tracks (
      id text primary key, user_id text not null, track_id text not null,
      created_at timestamp not null, updated_at timestamp not null
    )`);
    await source.query(`create table track_views (
      id text primary key, track_id text not null, user_id text,
      created_at timestamp not null, updated_at timestamp not null
    )`);
  };

  const seedLegacyRelations = async (userId: string): Promise<void> => {
    await source.query(
      `insert into artists values ('artist', 'Legacy Artist', 'video')`,
    );
    const ids = ['legacy-a', 'legacy-b', 'legacy-c', 'legacy-skipped'];
    for (const id of ids) {
      await source.query(
        `insert into tracks (id, yt_id, title, duration, duration_seconds,
          creator_id, created_at, updated_at)
         values ($1, 'legacy-video', 'Legacy song', '3:00', 180, $2, $3, $3)`,
        [id, userId, CREATED_AT],
      );
      await source.query(
        `insert into track_artists values ($1, 'artist', $2)`,
        [`artist-${id}`, id],
      );
    }
    await source.query(
      `insert into user_favorite_tracks values
       ('a-late', $1, 'legacy-a', '2022-01-01', '2022-01-02'),
       ('a-early', $1, 'legacy-b', $2, $3),
       ('z-early', $1, 'legacy-b', $2, $3),
       ('failed-favorite', $1, 'legacy-c', '2022-01-01', '2022-01-02'),
       ('skipped-favorite', $1, 'legacy-skipped', '2022-01-01', '2022-01-02')`,
      [userId, utcTimestamp(CREATED_AT), utcTimestamp(UPDATED_AT)],
    );
    await source.query(
      `insert into track_views values
       ('view-queued', 'legacy-a', $1, $2, $3),
       ('view-anonymous', 'legacy-c', null, '2020-02-03', '2021-03-04'),
       ('view-skipped', 'legacy-skipped', null, '2020-02-03', '2021-03-04')`,
      [userId, utcTimestamp(CREATED_AT), utcTimestamp(UPDATED_AT)],
    );
  };

  const utcTimestamp = (date: Date): string => date.toISOString().slice(0, -1);

  const plan = (options: {
    legacyTrackId: string;
    recordingMbid: string | null;
    digest: string;
    favorites: number;
    views: number;
    status?: string;
  }) => ({
    legacyTrackId: options.legacyTrackId,
    sourceDigest: options.digest,
    sourceCreatedAt: CREATED_AT,
    sourceCreatorId: 'legacy-ada',
    recordingMbid: options.recordingMbid,
    status: options.status ?? 'planned',
    rationale: options.status === 'skipped' ? 'no-match' : 'match',
    skipReason: options.status === 'skipped' ? 'no-match' : null,
    source: {
      id: options.legacyTrackId,
      dependentFavorites: options.favorites,
      dependentViews: options.views,
    },
  });
});

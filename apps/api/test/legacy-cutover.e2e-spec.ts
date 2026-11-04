import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { inject } from 'vitest';
import { z } from 'zod';
import { runLegacyCutover } from '../src/modules/legacy-import/legacy-cutover-command.js';
import { createAuthClient, signIn } from './utils/auth.js';
import {
  artistFixture,
  releaseGroupFixture,
} from './utils/catalog-fixtures.js';
import { resetDatabase } from './utils/database.js';
import { testMbid } from './utils/factories.js';
import {
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { youtubeVideo } from './utils/fake-youtube-music.js';
import {
  buildCutover,
  compiledCutover,
  consumeCutoverJobs,
  cutoverApp,
} from './utils/legacy-cutover-harness.js';
import { createCutoverSource } from './utils/legacy-cutover-source.js';
import { runNextTrackJob, runTrackJobs } from './utils/track-pipeline.js';
import { bohemian, processingOf } from './utils/track-processing-harness.js';

const DELAYED = testMbid(463);
const FAILED = testMbid(464);
const destinationId = z.object({ details: z.object({ id: z.string() }) });

describe('compiled staged legacy cutover (e2e)', () => {
  let redis: StartedTestContainer;
  let catalog: FakeMusicCatalog;
  let source: Awaited<ReturnType<typeof createCutoverSource>>;
  let harness: Awaited<ReturnType<typeof cutoverApp>>;
  let run: ReturnType<typeof compiledCutover>;
  let unavailable = false;
  const recordings = [
    bohemian({ mbid: DELAYED, title: 'Delayed song' }),
    bohemian({ mbid: FAILED, title: 'Failed song' }),
  ];

  beforeAll(async () => {
    await buildCutover();
    source = await createCutoverSource(inject('databaseUrl'));
    redis = await new GenericContainer('redis:8-alpine')
      .withExposedPorts(6379)
      .start();
    catalog = await startFakeMusicCatalog((payload) => {
      if (unavailable)
        return {
          error: { code: 'CATALOG_NOT_READY', message: 'Rehearsal outage' },
        };
      if ('query' in payload)
        return {
          result: {
            results: recordings
              .filter((row) => String(payload.query).includes(row.title))
              .map((row) => ({
                mbid: row.mbid,
                title: row.title,
                artistCredit: 'Queen',
                coverUrl: null,
                trackId: null,
              })),
          },
        };
      if (payload.mbid === testMbid(41)) return { result: artistFixture() };
      if (payload.mbid === testMbid(40))
        return { result: releaseGroupFixture({ coverArtUrl: '' }) };
      const recording = recordings.find((row) => row.mbid === payload.mbid);
      return recording
        ? { result: recording }
        : { error: { code: 'RECORDING_NOT_FOUND', message: 'No match' } };
    });
    harness = await cutoverApp(catalog.url);
    await resetDatabase(harness.app.db);
    run = compiledCutover({
      app: harness.app,
      sourceUrl: source.url,
      databaseUrl: inject('databaseUrl'),
      redisPort: redis.getMappedPort(6379),
      catalogUrl: catalog.url,
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.app.close();
    await catalog?.close();
    await redis?.stop();
    await source?.close();
  });

  it('rejects unknown stages without starting an application or deleting data', async () => {
    expect(await runLegacyCutover(['--legacy-cutover', 'reset'])).toBe(false);
  });

  it('resumes preparation, opens before Processing finishes, and reconciles retained failures and exclusions', async () => {
    await source.db.query(`insert into users (id,email,username,password,email_verified_at,daily_practice_target_seconds)
      select 'collision','ADA@EXAMPLE.COM','collision',password,email_verified_at,300 from users where id='ada'`);
    const invalidIdentity = await run('prepare');
    expect(invalidIdentity.code).toBe(1);
    expect(invalidIdentity.report).toMatchObject({
      ready: false,
      identityComplete: false,
      source: {
        errors: expect.arrayContaining(['EMAIL_CASE_COLLISION:ada,collision']),
      },
    });
    expect(catalog.seenQueries).toEqual([]);
    await source.db.query("delete from users where id='collision'");
    // Identity validation is complete, but a transient catalog outage must not save a skip.
    unavailable = true;
    const outage = await run('prepare');
    expect(outage.code).toBe(1);
    expect(outage.report).toMatchObject({
      ready: false,
      finished: false,
      recordings: { imported: 0, skipped: 0, pending: 4 },
    });
    unavailable = false;
    await source.db.query(`create function public.interrupt_cutover_463() returns trigger
      language plpgsql as $$ begin if new.legacy_id = 'c-failure' then
      raise exception 'rehearsal interruption'; end if; return new; end $$`);
    await source.db.query(`create trigger interrupt_cutover_463 before insert on public.legacy_track_ids
      for each row execute function public.interrupt_cutover_463()`);
    try {
      const interrupted = await run('prepare');
      expect(interrupted.code).toBe(1);
      expect(interrupted.report).toMatchObject({
        ready: false,
        finished: false,
        recordings: { imported: 1, duplicateTracks: 1, pending: 1, skipped: 1 },
      });
    } finally {
      await source.db.query(
        'drop trigger interrupt_cutover_463 on public.legacy_track_ids',
      );
      await source.db.query('drop function public.interrupt_cutover_463()');
    }
    const owner = createAuthClient(harness.app);
    await signIn(owner, {
      email: 'ada@example.com',
      password: 'original-password',
    }).expect(200);
    await owner
      .post('/v1/auth/change-password')
      .send({
        currentPassword: 'original-password',
        newPassword: 'updated-password',
      })
      .expect(200);
    const prepared = await run('prepare');
    expect(prepared.code).toBe(0);
    expect(prepared.report).toMatchObject({
      ready: true,
      finished: false,
      recordings: { imported: 2, duplicateTracks: 1, skipped: 1, pending: 0 },
      favorites: {
        source: 4,
        retained: 2,
        deduplicated: 1,
        skipped: 1,
        pending: 0,
      },
      views: { source: 3, imported: 2, skipped: 1, pending: 0 },
    });
    expect(prepared.output).not.toContain(source.url);
    expect(prepared.output).not.toContain('original-password');
    await signIn(createAuthClient(harness.app), {
      email: 'ada@example.com',
      password: 'updated-password',
    }).expect(200);
    await signIn(createAuthClient(harness.app), {
      email: 'bea@example.com',
      password: 'original-password',
    }).expect(200);
    const moved = await harness.app.http
      .get('/v1/tracks/a-original')
      .expect(404);
    const trackId = destinationId.parse(moved.body).details.id;
    const failedMove = await harness.app.http
      .get('/v1/tracks/c-failure')
      .expect(404);
    const failedId = destinationId.parse(failedMove.body).details.id;
    expect((await processingOf(harness.app, trackId)).processing).toMatchObject(
      {
        status: 'QUEUED',
      },
    );
    expect(await processingOf(harness.app, trackId)).toMatchObject({
      contributorCount: 1,
      contributors: [{ username: 'ada' }],
    });
    await harness.app.http
      .get('/v1/tracks/d-unmatched')
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    await harness.app.http
      .get('/v1/users/ada/favorites')
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    await owner
      .get('/v1/me/profile-visibility')
      .expect(200)
      .expect(({ body }) => expect(body.favorites).toBe(false));
    await owner
      .get('/v1/me/streak?timeZone=UTC')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          targetSeconds: 300,
          completedToday: true,
        }),
      );
    await owner
      .post(`/v1/tracks/${trackId}/views`)
      .send({ viewId: 'v1' })
      .expect(200)
      .expect(({ body }) => expect(body.viewId).toBe('v1'));
    await consumeCutoverJobs({
      app: harness.app,
      redisPort: redis.getMappedPort(6379),
      metadata: true,
    });
    expect((await run('continue')).code).toBe(0);
    harness.youtube.results = [youtubeVideo({ title: 'Delayed song' })];
    harness.notes.answers = [
      { status: 'IN_PROGRESS', output: 'DETECTING_NOTES' },
    ];
    await consumeCutoverJobs({
      app: harness.app,
      redisPort: redis.getMappedPort(6379),
    });
    while (
      (await processingOf(harness.app, trackId)).processing?.status !==
      'DETECTING_NOTES'
    ) {
      if (!(await runNextTrackJob(harness.app)))
        throw new Error('Missing delayed Processing job');
    }
    expect((await processingOf(harness.app, trackId)).processing).toMatchObject(
      {
        status: 'DETECTING_NOTES',
      },
    );
    const resumed = await run('continue');
    expect(resumed.report).toMatchObject({
      ready: true,
      finished: false,
      processing: { pending: 2 },
      tracks: expect.arrayContaining([
        expect.objectContaining({
          legacyId: 'a-original',
          runpodJobId: 'runpod-job-1',
          sourceCreatorId: 'ada',
          initialContributor: true,
        }),
      ]),
    });
    expect(harness.notes.starts).toHaveLength(1);
    harness.notes.answers = [{ status: 'COMPLETED' }];
    await runTrackJobs(harness.app);
    expect((await processingOf(harness.app, trackId)).processing).toMatchObject(
      {
        status: 'COMPLETED',
      },
    );
    await run('continue');
    harness.youtube.results = [youtubeVideo({ title: 'Failed song' })];
    harness.audio.requestFailure = new Error('Rehearsal audio failure');
    await consumeCutoverJobs({
      app: harness.app,
      redisPort: redis.getMappedPort(6379),
    });
    await runTrackJobs(harness.app);
    expect(
      (await processingOf(harness.app, failedId)).processing,
    ).toMatchObject({
      status: 'FAILED',
    });
    const final = await run('status');
    expect(final.code).toBe(0);
    expect(final.report).toMatchObject({
      ready: true,
      finished: true,
      processing: { pending: 0, completed: 1, failed: 1 },
      auxiliaryMaps: {
        artists: { mapped: 1, skipped: 1, pending: 0 },
        albums: { mapped: 1, skipped: 1, pending: 0 },
      },
      favorites: {
        source: 4,
        retained: 2,
        deduplicated: 1,
        skipped: 1,
        pending: 0,
      },
      views: { source: 3, imported: 2, skipped: 1, pending: 0 },
    });
    await owner
      .get('/v1/users/ada/favorites')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0].id).toBe(trackId);
      });
    expect(harness.notes.starts).toHaveLength(1);
    expect((await run('prepare')).report).toEqual(
      expect.objectContaining({ ready: true, finished: true }),
    );
    expect(await processingOf(harness.app, trackId)).toMatchObject({
      contributorCount: 1,
      contributors: [{ username: 'ada' }],
    });
  }, 180_000);
});

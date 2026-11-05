import { eq } from 'drizzle-orm';
import request from 'supertest';
import {
  legacyProcessingOrigins,
  legacyRecordingImports,
} from '../src/database/schema/legacy-recording-imports.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../src/database/schema/legacy-recording-plans.js';
import {
  trackContributions,
  trackContributors,
} from '../src/database/schema/track-contributors.js';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { legacyTrackIds } from '../src/database/schema/tracks.js';
import { users } from '../src/database/schema/users.js';
import { EMAIL_QUEUE } from '../src/integrations/email/email.job.js';
import { LegacyRecordingGroupModule } from '../src/modules/legacy-import/legacy-recording-group.module.js';
import { LegacyRecordingGroupRepository } from '../src/modules/legacy-import/legacy-recording-group.repository.js';
import { LegacyRecordingGroupService } from '../src/modules/legacy-import/legacy-recording-group.service.js';
import { TrackJobRunnerService } from '../src/modules/tracks/track-job-runner.service.js';
import { TRACK_PROCESSING_QUEUE } from '../src/modules/tracks/track-processing.job.js';
import { TrackRequestLimitRepository } from '../src/modules/tracks/track-request-limit.repository.js';
import { TRACK_METADATA_QUEUE } from '../src/queue/track-metadata.job.js';
import { createPasswordUser, testMbid, type User } from './utils/factories.js';
import {
  queuedTrackJobs,
  runNextTrackJob,
  runTrackJobs,
} from './utils/track-pipeline.js';
import {
  bohemian,
  processingOf,
  processingRowOf,
  requestTrackAs,
  resetTrackProcessingApp,
  retryTrackAs,
  startTrackProcessingApp,
  type TrackProcessingApp,
} from './utils/track-processing-harness.js';

const MBID = testMbid(1);
const HISTORICAL_DATE = new Date('2020-01-02T03:04:05Z');

describe('legacy Recording group (e2e)', () => {
  let harness: TrackProcessingApp;
  let importer: LegacyRecordingGroupService;
  let creator: User;

  beforeAll(async () => {
    harness = await startTrackProcessingApp([LegacyRecordingGroupModule]);
    importer = harness.testApp.app.get(LegacyRecordingGroupService);
  });
  afterAll(async () => {
    await harness?.close();
  });
  beforeEach(async () => {
    await resetTrackProcessingApp(harness);
    const first = await createPasswordUser(harness.testApp.db, {
      locale: 'pt-BR',
    });
    creator = first;
    const later = await createPasswordUser(harness.testApp.db);
    harness.testApp.queues[EMAIL_QUEUE]?.added.splice(0);
    harness.testApp.queues[TRACK_METADATA_QUEUE]?.added.splice(0);
    await harness.testApp.db.insert(legacyRecordingPlanRuns).values({
      id: 'legacy-recordings-v1',
      sourceDigest: 'frozen',
      sourceTracks: 2,
      status: 'complete',
    });
    await harness.testApp.db.insert(legacyRecordingPlans).values([
      {
        legacyTrackId: 'a-later',
        sourceDigest: 'frozen',
        sourceCreatedAt: new Date('2021-01-01Z'),
        sourceCreatorId: later.id,
        recordingMbid: MBID,
        status: 'planned',
        rationale: 'title,artist-credit,duration',
        source: {},
        initialContributor: false,
      },
      {
        legacyTrackId: 'z-earlier',
        sourceDigest: 'frozen',
        sourceCreatedAt: HISTORICAL_DATE,
        sourceCreatorId: first.id,
        recordingMbid: MBID,
        status: 'planned',
        rationale: 'title,artist-credit,duration',
        source: {},
        initialContributor: true,
      },
    ]);
  });

  it('prepares one queued Track with every map and only the earliest historical Contributor', async () => {
    const prepared = await importer.prepare(MBID);
    const state = await processingOf(harness.testApp, prepared.trackId);
    expect(state.processing?.status).toBe('QUEUED');
    expect(state.processing?.createdAt).not.toBe(HISTORICAL_DATE.toISOString());
    expect(state.contributorCount).toBe(1);
    const [contributor] = await harness.testApp.db
      .select()
      .from(trackContributors);
    const [contribution] = await harness.testApp.db
      .select()
      .from(trackContributions);
    const [earliest] = await harness.testApp.db
      .select()
      .from(legacyRecordingPlans)
      .where(eq(legacyRecordingPlans.legacyTrackId, 'z-earlier'));
    expect(contributor).toMatchObject({
      userId: earliest?.sourceCreatorId,
      createdAt: HISTORICAL_DATE,
    });
    expect(contribution).toMatchObject({
      kind: 'CREATE',
      createdAt: HISTORICAL_DATE,
    });
    expect(await harness.testApp.db.select().from(legacyTrackIds)).toEqual(
      expect.arrayContaining([
        { legacyId: 'a-later', trackId: prepared.trackId },
        { legacyId: 'z-earlier', trackId: prepared.trackId },
      ]),
    );
    expect(queuedTrackJobs(harness.testApp)).toEqual([]);
    expect(harness.testApp.queues[TRACK_METADATA_QUEUE]?.added).toHaveLength(1);
    await request(harness.testApp.app.getHttpServer())
      .get('/v1/tracks/a-later/processing')
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('RESOURCE_MOVED');
      });
    expect(await importer.prepare(MBID)).toEqual(prepared);
    expect(
      await harness.testApp.db.select().from(trackContributions),
    ).toHaveLength(1);
  });
  it('runs the existing pipeline silently and does not restart a completed group', async () => {
    const prepared = await importer.prepare(MBID);
    await importer.start(MBID);
    await runTrackJobs(harness.testApp);
    expect(
      (await processingOf(harness.testApp, prepared.trackId)).processing
        ?.status,
    ).toBe('COMPLETED');
    expect(harness.noteDetection.starts).toHaveLength(1);
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
    const [account] = await harness.testApp.db
      .select()
      .from(users)
      .where(eq(users.id, creator.id));
    expect(account?.locale).toBe('pt-BR');
    await importer.prepare(MBID);
    await importer.start(MBID);
    await harness.testApp.app
      .get(TrackJobRunnerService)
      .run(
        'run-step',
        { processingId: prepared.initialProcessingId, step: 'FINDING_VIDEO' },
        true,
      );
    await runTrackJobs(harness.testApp);
    expect(harness.noteDetection.starts).toHaveLength(1);
    expect(
      await harness.testApp.db.select().from(trackProcessings),
    ).toHaveLength(1);
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
  });

  it('keeps a retryable failure, retries as migration, then treats a User retry normally', async () => {
    const prepared = await importer.prepare(MBID);
    harness.youtube.searchFailure = new Error('YouTube unavailable');
    await importer.start(MBID);
    await runTrackJobs(harness.testApp);
    expect(
      (await processingOf(harness.testApp, prepared.trackId)).processing,
    ).toMatchObject({ status: 'FAILED', retryable: true });
    expect(await harness.testApp.db.select().from(legacyTrackIds)).toHaveLength(
      2,
    );
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
    await importer.retry(MBID);
    await runTrackJobs(harness.testApp);
    expect(
      await harness.testApp.db.select().from(legacyProcessingOrigins),
    ).toHaveLength(2);
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
    harness.youtube.searchFailure = undefined;
    const retrier = await createPasswordUser(harness.testApp.db);
    expect(
      (await retryTrackAs(harness.testApp, retrier, prepared.trackId, 'en'))
        .status,
    ).toBe(202);
    const limits = harness.testApp.app.get(TrackRequestLimitRepository);
    expect(await limits.countActiveProcessings(retrier.id)).toBe(1);
    expect(await limits.countActiveProcessings(creator.id)).toBe(0);
    await expect(importer.start(MBID)).rejects.toThrow(
      'MIGRATION_PROCESSING_CHANGED',
    );
    await runTrackJobs(harness.testApp);
    expect(
      (await processingOf(harness.testApp, prepared.trackId)).processing
        ?.status,
    ).toBe('COMPLETED');
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toHaveLength(2);
    expect(
      await harness.testApp.db.select().from(trackContributors),
    ).toHaveLength(2);
    expect(
      await harness.testApp.db.select().from(legacyProcessingOrigins),
    ).toHaveLength(2);
  });

  it('leaves final failures final and preserves mapped versus unmapped reads', async () => {
    const prepared = await importer.prepare(MBID);
    harness.youtube.results = [];
    await importer.start(MBID);
    await runTrackJobs(harness.testApp);
    expect(
      (await processingOf(harness.testApp, prepared.trackId)).processing,
    ).toMatchObject({
      status: 'FAILED',
      failureCode: 'VIDEO_NOT_FOUND',
      retryable: false,
    });
    await expect(importer.retry(MBID)).rejects.toThrow(
      'PROCESSING_NOT_RETRYABLE',
    );
    await request(harness.testApp.app.getHttpServer())
      .get('/v1/tracks/a-later')
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('RESOURCE_MOVED'));
    await request(harness.testApp.app.getHttpServer())
      .get('/v1/tracks/unmapped-legacy-id')
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
    expect(
      await harness.testApp.db.select().from(trackContributors),
    ).toHaveLength(1);
  });

  it('excludes only migration attempts from quotas and preserves normal requests and emails', async () => {
    await importer.prepare(MBID);
    const limits = harness.testApp.app.get(TrackRequestLimitRepository);
    expect(await limits.countActiveProcessings(creator.id)).toBe(0);
    expect(
      await limits.countNewTracksBetween(
        creator.id,
        new Date(0),
        new Date('2100-01-01T00:00:00Z'),
      ),
    ).toBe(0);
    harness.recordings.set(testMbid(2), bohemian({ mbid: testMbid(2) }));
    const ordinaryTrack = await requestTrackAs(
      harness,
      creator,
      'pt-BR',
      testMbid(2),
    );
    expect(await limits.countActiveProcessings(creator.id)).toBe(1);
    expect(
      await limits.countNewTracksBetween(
        creator.id,
        new Date(0),
        new Date('2100-01-01T00:00:00Z'),
      ),
    ).toBe(1);
    await runTrackJobs(harness.testApp);
    expect(
      (await processingOf(harness.testApp, ordinaryTrack)).processing?.status,
    ).toBe('COMPLETED');
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toHaveLength(1);
  });

  it('recovers committed creation before acknowledgement and a refused enqueue', async () => {
    const repository = harness.testApp.app.get(LegacyRecordingGroupRepository);
    const acknowledge = vi
      .spyOn(repository, 'acknowledge')
      .mockRejectedValueOnce(new Error('interrupted'));
    await expect(importer.prepare(MBID)).rejects.toThrow('interrupted');
    acknowledge.mockRestore();
    expect(
      await harness.testApp.db.select().from(legacyRecordingImports),
    ).toHaveLength(0);
    const prepared = await importer.prepare(MBID);
    expect(
      await harness.testApp.db.select().from(trackProcessings),
    ).toHaveLength(1);
    expect(
      await harness.testApp.db.select().from(trackContributions),
    ).toHaveLength(1);
    const queue = harness.testApp.queues[TRACK_PROCESSING_QUEUE];
    if (!queue) throw new Error('Missing Processing queue');
    const add = vi
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(importer.start(MBID)).rejects.toThrow('Redis unavailable');
    add.mockRestore();
    await importer.start(MBID);
    await runTrackJobs(harness.testApp);
    expect(
      (await processingOf(harness.testApp, prepared.trackId)).processing
        ?.status,
    ).toBe('COMPLETED');
    expect(
      await harness.testApp.db.select().from(trackProcessings),
    ).toHaveLength(1);
  });

  it('polls the saved external job after interruption instead of submitting again', async () => {
    const prepared = await importer.prepare(MBID);
    harness.noteDetection.answers = [
      { status: 'IN_PROGRESS', output: 'EXTRACTING_VOCALS' },
    ];
    await importer.start(MBID);
    for (
      let steps = 0;
      steps < 10 && harness.noteDetection.starts.length === 0;
      steps++
    )
      await runNextTrackJob(harness.testApp);
    expect(
      (await processingRowOf(harness.testApp, prepared.trackId)).runpodJobId,
    ).toBe('runpod-job-1');
    await importer.prepare(MBID);
    await importer.start(MBID);
    harness.noteDetection.answers = [{ status: 'COMPLETED' }];
    await runTrackJobs(harness.testApp);
    expect(
      (await processingOf(harness.testApp, prepared.trackId)).processing
        ?.status,
    ).toBe('COMPLETED');
    expect(harness.noteDetection.starts).toHaveLength(1);
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
  });
  it('completes without optional lyrics after transcription is exhausted', async () => {
    const prepared = await importer.prepare(MBID);
    harness.noteDetection.answers = [
      { status: 'IN_PROGRESS', output: 'EXTRACTING_VOCALS' },
    ];
    await importer.start(MBID);
    for (
      let steps = 0;
      steps < 10 && harness.noteDetection.starts.length === 0;
      steps++
    )
      await runNextTrackJob(harness.testApp);
    const pending = await processingRowOf(harness.testApp, prepared.trackId);
    const music = await fetch(pending.musicWavUrl ?? '');
    expect(
      (
        await harness.noteDetection.uploadVocals(
          'runpod-job-1',
          new Uint8Array(await music.arrayBuffer()),
        )
      ).status,
    ).toBe(200);
    harness.noteDetection.answers = [{ status: 'COMPLETED' }];
    harness.transcription.requestFailure = new Error('Scribe unavailable');
    await runTrackJobs(harness.testApp);
    expect(harness.transcription.requests).toHaveLength(1);
    expect(
      (await processingOf(harness.testApp, prepared.trackId)).processing
        ?.status,
    ).toBe('COMPLETED');
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
  });

  it('recovers a metadata enqueue failure and concurrent preparations without duplicate rows', async () => {
    const queue = harness.testApp.queues[TRACK_METADATA_QUEUE];
    if (!queue) throw new Error('Missing metadata queue');
    const add = vi
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(importer.prepare(MBID)).rejects.toThrow('Redis unavailable');
    add.mockRestore();
    const [first, second] = await Promise.all([
      importer.prepare(MBID),
      importer.prepare(MBID),
    ]);
    expect(first).toEqual(second);
    expect(
      await harness.testApp.db.select().from(trackProcessings),
    ).toHaveLength(1);
    expect(
      await harness.testApp.db.select().from(trackContributions),
    ).toHaveLength(1);
    expect(await harness.testApp.db.select().from(legacyTrackIds)).toHaveLength(
      2,
    );
    expect(queuedTrackJobs(harness.testApp)).toEqual([]);
  });

  it('recovers an interrupted retry acknowledgement with the same new attempt', async () => {
    await importer.prepare(MBID);
    harness.youtube.searchFailure = new Error('YouTube unavailable');
    await importer.start(MBID);
    await runTrackJobs(harness.testApp);
    const repository = harness.testApp.app.get(LegacyRecordingGroupRepository);
    const acknowledge = vi
      .spyOn(repository, 'acknowledgeRetry')
      .mockRejectedValueOnce(new Error('interrupted'));
    await expect(importer.retry(MBID)).rejects.toThrow('interrupted');
    acknowledge.mockRestore();
    await importer.retry(MBID);
    expect(
      await harness.testApp.db.select().from(trackProcessings),
    ).toHaveLength(2);
    expect(
      await harness.testApp.db.select().from(trackContributions),
    ).toHaveLength(2);
    await runTrackJobs(harness.testApp);
    expect(harness.testApp.queues[EMAIL_QUEUE]?.added).toEqual([]);
  });

  it.each(['incomplete', 'changed', 'attribution', 'unknown'])(
    'refuses an invalid %s plan without creating a Track',
    async (reason) => {
      if (reason === 'incomplete')
        await harness.testApp.db
          .update(legacyRecordingPlanRuns)
          .set({ status: 'incomplete' });
      if (reason === 'changed')
        await harness.testApp.db
          .update(legacyRecordingPlanRuns)
          .set({ sourceDigest: 'changed' });
      if (reason === 'attribution')
        await harness.testApp.db
          .update(legacyRecordingPlans)
          .set({ initialContributor: false });
      await expect(
        importer.prepare(reason === 'unknown' ? testMbid(99) : MBID),
      ).rejects.toThrow();
      expect(
        await harness.testApp.db.select().from(trackProcessings),
      ).toHaveLength(0);
      expect(
        await harness.testApp.db.select().from(legacyTrackIds),
      ).toHaveLength(0);
    },
  );
});

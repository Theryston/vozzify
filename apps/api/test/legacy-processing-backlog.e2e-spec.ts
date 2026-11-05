import { Test } from '@nestjs/testing';
import { asc, eq, isNotNull } from 'drizzle-orm';
import { ENV } from '../src/config/env.js';
import { legacyProcessingAdmissions } from '../src/database/schema/legacy-processing-admissions.js';
import {
  legacyProcessingOrigins,
  legacyRecordingImports,
} from '../src/database/schema/legacy-recording-imports.js';
import {
  legacyRecordingPlanRuns,
  legacyRecordingPlans,
} from '../src/database/schema/legacy-recording-plans.js';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { LegacyProcessingAdmissionService } from '../src/modules/legacy-import/legacy-processing-admission.service.js';
import { LegacyProcessingBacklogModule } from '../src/modules/legacy-import/legacy-processing-backlog.module.js';
import { LegacyProcessingBacklogRepository } from '../src/modules/legacy-import/legacy-processing-backlog.repository.js';
import { LegacyProcessingBacklogService } from '../src/modules/legacy-import/legacy-processing-backlog.service.js';
import { LegacyRecordingGroupModule } from '../src/modules/legacy-import/legacy-recording-group.module.js';
import { LegacyRecordingGroupService } from '../src/modules/legacy-import/legacy-recording-group.service.js';
import { TrackMigrationService } from '../src/modules/tracks/track-migration.service.js';
import {
  runStepJobSchema,
  TRACK_PROCESSING_QUEUE,
} from '../src/modules/tracks/track-processing.job.js';
import { TRACK_METADATA_QUEUE } from '../src/queue/track-metadata.job.js';
import { createPasswordUser, testMbid } from './utils/factories.js';
import {
  queuedTrackJobs,
  runNextTrackJob,
  runTrackJobs,
} from './utils/track-pipeline.js';
import { createTrackProcessing } from './utils/track-processing-factories.js';
import {
  bohemian,
  resetTrackProcessingApp,
  startTrackProcessingApp,
  type TrackProcessingApp,
} from './utils/track-processing-harness.js';

const RECORDING_MBIDS = [
  testMbid(71),
  testMbid(72),
  testMbid(73),
  testMbid(74),
  testMbid(75),
];

const waitForSavedNoteJob = async (app: TrackProcessingApp): Promise<void> => {
  for (;;) {
    const queued = queuedTrackJobs(app.testApp);
    const waiting = queued.some((job) => {
      const parsed = runStepJobSchema.safeParse(job.data);
      return (
        parsed.success &&
        parsed.data.step === 'DETECTING_NOTES' &&
        parsed.data.wait
      );
    });
    if (waiting) return;
    if (queued.length === 0)
      throw new Error('No Track Processing job was queued');
    await runNextTrackJob(app.testApp);
  }
};

describe('legacy Processing backlog (e2e)', () => {
  let app: TrackProcessingApp;
  let groups: LegacyRecordingGroupService;
  let backlog: LegacyProcessingBacklogService;

  beforeAll(async () => {
    app = await startTrackProcessingApp([
      LegacyRecordingGroupModule,
      LegacyProcessingBacklogModule,
    ]);
    groups = app.testApp.app.get(LegacyRecordingGroupService);
    backlog = app.testApp.app.get(LegacyProcessingBacklogService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetTrackProcessingApp(app);
    app.testApp.app.get(ENV).LEGACY_PROCESSING_CONCURRENCY = 2;
    const creator = await createPasswordUser(app.testApp.db);
    app.testApp.queues[TRACK_METADATA_QUEUE]?.added.splice(0);
    app.testApp.queues[TRACK_PROCESSING_QUEUE]?.added.splice(0);
    await app.testApp.db.insert(legacyRecordingPlanRuns).values({
      id: 'legacy-recordings-v1',
      sourceDigest: 'frozen',
      sourceTracks: RECORDING_MBIDS.length,
      status: 'complete',
    });
    for (const [index, mbid] of RECORDING_MBIDS.entries()) {
      app.recordings.set(mbid, bohemian({ mbid }));
      await app.testApp.db.insert(legacyRecordingPlans).values({
        legacyTrackId: `legacy-${index}`,
        sourceDigest: 'frozen',
        sourceCreatedAt: new Date(`2021-01-0${index + 1}T00:00:00Z`),
        sourceCreatorId: creator.id,
        recordingMbid: mbid,
        status: 'planned',
        rationale: 'title,artist-credit,duration',
        source: {},
        initialContributor: true,
      });
    }
    for (const mbid of RECORDING_MBIDS) await groups.prepare(mbid);
  });

  it('admits five prepared groups in bounded batches and resumes after a fresh context restart', async () => {
    expect(
      await app.testApp.app
        .get(LegacyProcessingBacklogRepository)
        .hasPendingWork(),
    ).toBe(true);
    const firstCycle = await backlog.runCycle();
    expect(firstCycle).toMatchObject({ queued: 3, admitted: 2, running: 0 });
    expect(
      await app.testApp.db.select().from(legacyProcessingAdmissions),
    ).toHaveLength(2);
    expect(queuedTrackJobs(app.testApp)).toHaveLength(2);
    expect(
      await app.testApp.app
        .get(LegacyProcessingBacklogRepository)
        .hasPendingWork(),
    ).toBe(true);

    // Leave both admitted Processings waiting on persisted RunPod jobs while
    // the third prepared Recording remains queued.
    app.noteDetection.answers = [
      { status: 'IN_PROGRESS', output: 'DETECTING_NOTES' },
    ];
    await waitForSavedNoteJob(app);
    const [pending] = await app.testApp.db
      .select()
      .from(trackProcessings)
      .where(eq(trackProcessings.runpodJobId, 'runpod-job-1'));
    expect(pending?.runpodJobId).toBe('runpod-job-1');
    const savedJobs = await app.testApp.db
      .select({ runpodJobId: trackProcessings.runpodJobId })
      .from(trackProcessings)
      .where(isNotNull(trackProcessings.runpodJobId));
    expect(savedJobs).toHaveLength(2);
    const startsBeforeRestart = app.noteDetection.starts.length;
    expect(startsBeforeRestart).toBe(2);

    // A fresh runner context reuses the live app's durable DB and queue
    // providers, avoiding a second lifecycle owner for the same test database.
    const restartContext = await Test.createTestingModule({
      providers: [
        LegacyProcessingBacklogService,
        {
          provide: ENV,
          useValue: app.testApp.app.get(ENV),
        },
        {
          provide: LegacyProcessingBacklogRepository,
          useValue: app.testApp.app.get(LegacyProcessingBacklogRepository),
        },
        {
          provide: LegacyProcessingAdmissionService,
          useValue: app.testApp.app.get(LegacyProcessingAdmissionService),
        },
        {
          provide: TrackMigrationService,
          useValue: app.testApp.app.get(TrackMigrationService),
        },
      ],
    }).compile();
    try {
      const restarted = restartContext.get(LegacyProcessingBacklogService);
      const afterRestart = await restarted.runCycle();
      expect(afterRestart).toMatchObject({
        queued: 3,
        admitted: 0,
        running: 2,
      });
      expect(app.noteDetection.starts).toHaveLength(startsBeforeRestart);
      expect(queuedTrackJobs(app.testApp)).toHaveLength(2);
      expect(
        await app.testApp.db.select().from(legacyProcessingAdmissions),
      ).toHaveLength(2);
    } finally {
      await restartContext.close();
    }

    app.noteDetection.answers = [{ status: 'COMPLETED' }];
    await runTrackJobs(app.testApp);
    const afterCompletion = await backlog.runCycle();
    expect(afterCompletion).toMatchObject({
      queued: 1,
      admitted: 2,
      completed: 2,
    });
    expect(queuedTrackJobs(app.testApp)).toHaveLength(2);
  });

  it('keeps a manually started second group within the concurrency-one cap', async () => {
    app.testApp.app.get(ENV).LEGACY_PROCESSING_CONCURRENCY = 1;
    const [, secondMbid] = RECORDING_MBIDS;
    if (secondMbid === undefined)
      throw new Error('Second Recording fixture was not set');
    await groups.start(secondMbid);
    const jobsBeforeAdmission = queuedTrackJobs(app.testApp).length;
    expect(jobsBeforeAdmission).toBe(1);
    expect(
      await app.testApp.db.select().from(legacyProcessingAdmissions),
    ).toHaveLength(1);

    const report = await backlog.runCycle();
    expect(report).toMatchObject({ queued: 4, admitted: 1, running: 0 });
    expect(
      await app.testApp.db.select().from(legacyProcessingAdmissions),
    ).toHaveLength(1);
    expect(queuedTrackJobs(app.testApp)).toHaveLength(jobsBeforeAdmission);

    await runTrackJobs(app.testApp);
    expect(await backlog.runCycle()).toMatchObject({
      queued: 3,
      admitted: 1,
      completed: 1,
    });
  });

  it('blocks a manual start at a full cap and admits it after the active slot completes', async () => {
    app.testApp.app.get(ENV).LEGACY_PROCESSING_CONCURRENCY = 1;
    const firstCycle = await backlog.runCycle();
    expect(firstCycle).toMatchObject({ queued: 4, admitted: 1 });

    const [, secondMbid] = RECORDING_MBIDS;
    if (secondMbid === undefined)
      throw new Error('Second Recording fixture was not set');
    await expect(groups.start(secondMbid)).resolves.toBe('capacity-full');
    expect(queuedTrackJobs(app.testApp)).toHaveLength(1);
    expect(
      await app.testApp.db.select().from(legacyProcessingAdmissions),
    ).toHaveLength(1);

    await runTrackJobs(app.testApp);
    expect(await backlog.runCycle()).toMatchObject({
      queued: 3,
      admitted: 1,
      completed: 1,
    });
    expect(
      await app.testApp.db.select().from(legacyProcessingAdmissions),
    ).toHaveLength(2);
  });

  it('adopts an older running migration before allowing a manual start', async () => {
    app.testApp.app.get(ENV).LEGACY_PROCESSING_CONCURRENCY = 1;
    const [first] = await app.testApp.db
      .select()
      .from(trackProcessings)
      .orderBy(asc(trackProcessings.createdAt));
    if (first === undefined) throw new Error('Prepared Processing is missing');
    await app.testApp.db
      .update(trackProcessings)
      .set({ status: 'DETECTING_NOTES', runpodJobId: 'preexisting-job' })
      .where(eq(trackProcessings.id, first.id));

    const [, secondMbid] = RECORDING_MBIDS;
    if (secondMbid === undefined)
      throw new Error('Second Recording fixture was not set');
    await expect(groups.start(secondMbid)).resolves.toBe('capacity-full');

    const admissions = await app.testApp.db
      .select()
      .from(legacyProcessingAdmissions);
    expect(admissions).toHaveLength(1);
    expect(admissions[0]?.id).toBe(first.id);
    expect(queuedTrackJobs(app.testApp)).toHaveLength(0);

    await app.testApp.db
      .update(trackProcessings)
      .set({ status: 'COMPLETED', runpodJobId: null })
      .where(eq(trackProcessings.id, first.id));
    expect(await backlog.runCycle()).toMatchObject({
      queued: 3,
      admitted: 1,
      completed: 1,
    });
  });

  it('counts an unacknowledged running retry before a manual admission', async () => {
    app.testApp.app.get(ENV).LEGACY_PROCESSING_CONCURRENCY = 1;
    const [first] = await app.testApp.db
      .select()
      .from(legacyRecordingImports)
      .orderBy(asc(legacyRecordingImports.id));
    if (first === undefined) throw new Error('Prepared group is missing');
    await app.testApp.db
      .update(trackProcessings)
      .set({ status: 'FAILED' })
      .where(eq(trackProcessings.id, first.processingId));
    const retry = await createTrackProcessing(app.testApp.db, first.trackId, {
      createdAt: new Date(Date.now() + 1_000),
      status: 'DETECTING_NOTES',
      runpodJobId: 'unacknowledged-retry',
    });
    await app.testApp.db.insert(legacyProcessingOrigins).values({
      id: retry.id,
      recordingMbid: first.id,
    });

    const [, secondMbid] = RECORDING_MBIDS;
    if (secondMbid === undefined)
      throw new Error('Second Recording fixture was not set');
    await expect(groups.start(secondMbid)).resolves.toBe('capacity-full');
    const admissions = await app.testApp.db
      .select()
      .from(legacyProcessingAdmissions);
    expect(admissions.map((row) => row.id)).toEqual([retry.id]);
    expect(queuedTrackJobs(app.testApp)).toHaveLength(0);
    const [reconciled] = await app.testApp.db
      .select()
      .from(legacyRecordingImports)
      .where(eq(legacyRecordingImports.id, first.id));
    expect(reconciled?.processingId).toBe(retry.id);
  });

  it('drains accepted reservations after lowering the limit without admitting more', async () => {
    const admission = app.testApp.app.get(LegacyProcessingAdmissionService);
    const accepted = await admission.admit(2);
    expect(accepted).toHaveLength(2);
    expect(queuedTrackJobs(app.testApp)).toHaveLength(0);
    app.testApp.app.get(ENV).LEGACY_PROCESSING_CONCURRENCY = 1;

    expect(await backlog.runCycle()).toMatchObject({
      queued: 3,
      admitted: 2,
      running: 0,
    });
    expect(queuedTrackJobs(app.testApp)).toHaveLength(2);
    expect(
      (await app.testApp.db.select().from(legacyProcessingAdmissions)).map(
        (row) => row.id,
      ),
    ).toEqual(expect.arrayContaining(accepted.map((row) => row.processingId)));

    await runTrackJobs(app.testApp);
    expect(await backlog.runCycle()).toMatchObject({
      queued: 2,
      admitted: 1,
      completed: 2,
    });
    expect(queuedTrackJobs(app.testApp)).toHaveLength(1);
    expect(await app.testApp.db.select().from(trackProcessings)).toHaveLength(
      5,
    );
  });

  it('releases a final-failure slot and admits another prepared Processing', async () => {
    await backlog.runCycle();
    app.youtube.searchFailure = new Error('Legacy video search failed');
    await runNextTrackJob(app.testApp);
    app.youtube.searchFailure = undefined;
    await runTrackJobs(app.testApp);

    const report = await backlog.runCycle();
    expect(report).toMatchObject({
      queued: 1,
      admitted: 2,
      completed: 1,
      failed: 1,
    });
    expect(
      await app.testApp.db.select().from(legacyProcessingAdmissions),
    ).toHaveLength(4);
  });

  it('recovers the same reserved Processing after queue enqueue interruption', async () => {
    const queue = app.testApp.queues[TRACK_PROCESSING_QUEUE];
    if (queue === undefined)
      throw new Error('Processing queue is not registered');
    const originalAdd = queue.add;
    let interruptNext = true;
    queue.add = async (name, data, options) => {
      if (interruptNext) {
        interruptNext = false;
        throw new Error('Temporary queue failure');
      }
      return originalAdd(name, data, options);
    };
    try {
      const first = await backlog.runCycle();
      expect(first).toMatchObject({ queued: 3, admitted: 2 });
      expect(queuedTrackJobs(app.testApp)).toHaveLength(1);
      const [unstarted] = await app.testApp.app
        .get(LegacyProcessingBacklogRepository)
        .unstartedQueued();
      if (unstarted === undefined)
        throw new Error('Failed enqueue was not reserved');

      const resumed = await backlog.runCycle();
      expect(resumed).toMatchObject({ queued: 3, admitted: 2 });
      expect(queuedTrackJobs(app.testApp)).toHaveLength(2);
      expect(
        queuedTrackJobs(app.testApp).some((job) => {
          const parsed = runStepJobSchema.safeParse(job.data);
          return (
            parsed.success &&
            parsed.data.processingId === unstarted.processingId
          );
        }),
      ).toBe(true);
      expect(
        await app.testApp.db.select().from(legacyProcessingAdmissions),
      ).toHaveLength(2);
    } finally {
      queue.add = originalAdd;
    }
  });
});

import { fileURLToPath } from 'node:url';
import { privateTrackDetailSchema } from '@vozzify/contracts';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import {
  privateTrackNotes,
  privateTracks,
} from '../src/database/schema/private-tracks.js';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../src/integrations/note-detection/note-detection.client.js';
import { StorageService } from '../src/integrations/storage/storage.service.js';
import { PROCESS_PRIVATE_TRACK_JOB } from '../src/modules/private-tracks/private-track-processing.job.js';
import { PrivateTrackProcessingProcessor } from '../src/modules/private-tracks/private-track-processing.processor.js';
import { PrivateTrackProcessingService } from '../src/modules/private-tracks/private-track-processing.service.js';
import { PrivateTracksRepository } from '../src/modules/private-tracks/private-tracks.repository.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { billingCatalog } from './utils/billing-fixture.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createPasswordUser, DEFAULT_PASSWORD } from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';

const FIXTURE = fileURLToPath(
  new URL('../../web/e2e/fixtures/a4-440hz.wav', import.meta.url),
);
const MP3_FIXTURE = fileURLToPath(
  new URL('./fixtures/tone.mp3', import.meta.url),
);
const ROOT = '/v1/me/private-tracks';
const detectorInputs = new Map<string, NoteDetectionInput>();
const fakeDetector = {
  startJob: vi.fn(async (input: NoteDetectionInput) => {
    const jobId = `fake-${input.processingId}-${detectorInputs.size + 1}`;
    detectorInputs.set(jobId, input);
    return jobId;
  }),
  checkJob: vi.fn(async (jobId: string) => {
    const input = detectorInputs.get(jobId);
    if (!input) throw new Error(`Unknown fake detector job ${jobId}`);
    return {
      kind: 'completed' as const,
      output: {
        vocalsUrl: input.vocalsUpload.publicUrl,
        pitchCurveUrl: input.pitchCurveUpload.publicUrl,
        detectorVersion: 'fake-private-e2e',
        notes: [
          {
            pitch: 60 + [...detectorInputs.keys()].indexOf(jobId),
            start: 0.1,
            end: 0.3,
          },
        ],
      },
    };
  }),
};

describe('Private track detail and playback (e2e)', () => {
  let testApp: TestApp;
  let catalog: Awaited<ReturnType<typeof startFakeMusicCatalog>>;
  let catalogSeeded = false;

  beforeAll(async () => {
    catalog = await startFakeMusicCatalog(() => ({ result: { results: [] } }));
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      },
      override: (builder) =>
        builder.overrideProvider(NoteDetectionClient).useValue(fakeDetector),
    });
  });

  afterAll(async () => {
    await testApp.close();
    await catalog.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    catalogSeeded = false;
    detectorInputs.clear();
    fakeDetector.startJob.mockClear();
    fakeDetector.checkJob.mockClear();
    await resetDatabase(testApp.db);
  });

  const grantPro = async (userId: string) => {
    if (!catalogSeeded) {
      await billingCatalog(testApp);
      catalogSeeded = true;
    }
    await testApp.db.insert(subscriptions).values({
      userId,
      planId: 'pro',
      priceId: 'usd-monthly',
      cycle: 'monthly',
      currency: 'USD',
      amount: 350,
      stripePriceId: 'price_usd_monthly',
      status: 'confirmed',
      providerStatus: 'active',
      paidMembership: true,
      hasPaidInvoice: true,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  };

  it('finds queued and stale starts for bounded recovery without terminal rows', async () => {
    const owner = await createPasswordUser(testApp.db);
    const [queued] = await testApp.db
      .insert(privateTracks)
      .values({
        userId: owner.id,
        contentSha256: 'legacy-private-queued-hash',
        objectKey: `${owner.id}/legacy-private-queued`,
        originalFilename: 'legacy.wav',
        title: 'Legacy private row',
        artist: '',
        durationMs: 1_000,
      })
      .returning();
    const [completed] = await testApp.db
      .insert(privateTracks)
      .values({
        userId: owner.id,
        contentSha256: 'private-completed-hash',
        objectKey: `${owner.id}/private-completed`,
        originalFilename: 'completed.wav',
        title: 'Completed private row',
        artist: '',
        durationMs: 1_000,
        processingStatus: 'COMPLETED',
      })
      .returning();
    const [stale] = await testApp.db
      .insert(privateTracks)
      .values({
        userId: owner.id,
        contentSha256: 'legacy-stale-private-hash',
        objectKey: `${owner.id}/legacy-stale-private`,
        originalFilename: 'stale.wav',
        title: 'Stale private row',
        artist: '',
        durationMs: 1_000,
        processingStatus: 'EXTRACTING_VOCALS',
        processingAttemptId: 'launch-with-lost-response',
        updatedAt: new Date(Date.now() - 120_000),
      })
      .returning();
    if (!queued || !completed || !stale) {
      throw new Error('Expected private track rows');
    }

    const candidates = await testApp.app
      .get(PrivateTracksRepository)
      .listRecoverable(100, new Date(Date.now() - 60_000));

    expect(candidates.map((row) => row.id)).toContain(queued.id);
    expect(candidates.map((row) => row.id)).toContain(stale.id);
    expect(candidates.map((row) => row.id)).not.toContain(completed.id);
  });
  it('returns owner-only recording notes and hides private detail from other users', async () => {
    const owner = await createPasswordUser(testApp.db);
    const other = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    await grantPro(other.id);
    const [track] = await testApp.db
      .insert(privateTracks)
      .values({
        userId: owner.id,
        contentSha256: 'private-detail-hash',
        objectKey: `${owner.id}/private-detail-source`,
        originalFilename: 'recording.wav',
        title: 'Private recording',
        artist: 'Local artist',
        durationMs: 1_000,
        processingStatus: 'COMPLETED',
        processingProgress: 100,
      })
      .returning();
    if (!track) throw new Error('Expected the private track row');
    await testApp.db.insert(privateTrackNotes).values({
      privateTrackId: track.id,
      pitch: 69,
      start: 0.25,
      end: 0.5,
    });

    const ownerClient = createAuthClient(testApp);
    await signIn(ownerClient, {
      email: owner.email,
      password: DEFAULT_PASSWORD,
    });
    const detailResponse = await ownerClient
      .get(`${ROOT}/${track.id}`)
      .expect(200);
    expect(detailResponse.headers['cache-control']).toBe('private, no-store');
    expect(privateTrackDetailSchema.parse(detailResponse.body)).toMatchObject({
      id: track.id,
      ownerId: owner.id,
      locked: false,
      processing: { status: 'COMPLETED', progress: 100 },
      notes: [{ pitch: 69, start: 0.25, end: 0.5 }],
    });
    expect(detailResponse.body).not.toHaveProperty('mediaUrl');

    const otherClient = createAuthClient(testApp);
    await signIn(otherClient, {
      email: other.email,
      password: DEFAULT_PASSWORD,
    });
    await otherClient.get(`${ROOT}/${track.id}`).expect(404);
  });

  it('streams only an authenticated byte range for a Pro owner', async () => {
    const owner = await createPasswordUser(testApp.db);
    const other = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    await grantPro(other.id);
    const objectKey = `private-tracks/${owner.id}/stream-source/music.wav`;
    await testApp.app.get(StorageService).putPrivateFile({
      key: objectKey,
      filePath: FIXTURE,
      contentType: 'audio/wav',
    });
    const [track] = await testApp.db
      .insert(privateTracks)
      .values({
        userId: owner.id,
        contentSha256: 'private-stream-hash',
        objectKey: `${owner.id}/private-stream-source`,
        originalFilename: 'stream.wav',
        title: 'Private stream',
        artist: '',
        durationMs: 1_000,
        processingStatus: 'COMPLETED',
        processingProgress: 100,
        mediaObjectKey: objectKey,
      })
      .returning();
    if (!track) throw new Error('Expected the private track row');

    const ownerClient = createAuthClient(testApp);
    await signIn(ownerClient, {
      email: owner.email,
      password: DEFAULT_PASSWORD,
    });
    const ranged = await ownerClient
      .get(`${ROOT}/${track.id}/media/music`)
      .set('Range', 'bytes=0-3')
      .expect(206);
    expect(ranged.headers['cache-control']).toBe('private, no-store');
    expect(ranged.headers['content-range']).toMatch(/^bytes 0-3\//);
    expect(ranged.headers['content-length']).toBe('4');
    await ownerClient
      .get(`${ROOT}/${track.id}/media/music`)
      .set('Range', 'bytes=999999-')
      .expect(416);

    const otherClient = createAuthClient(testApp);
    await signIn(otherClient, {
      email: other.email,
      password: DEFAULT_PASSWORD,
    });
    await otherClient.get(`${ROOT}/${track.id}/media/music`).expect(404);
    await request(testApp.app.getHttpServer())
      .get(`${ROOT}/${track.id}/media/music`)
      .expect(401);
  });

  it('shows metadata while locked and refuses owner media until Pro returns', async () => {
    const owner = await createPasswordUser(testApp.db);
    const [track] = await testApp.db
      .insert(privateTracks)
      .values({
        userId: owner.id,
        contentSha256: 'private-locked-hash',
        objectKey: `${owner.id}/private-locked-source`,
        originalFilename: 'locked.wav',
        title: 'Locked recording',
        artist: '',
        durationMs: 1_000,
        processingStatus: 'COMPLETED',
        processingProgress: 100,
      })
      .returning();
    if (!track) throw new Error('Expected the private track row');
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });

    expect(
      privateTrackDetailSchema.parse(
        (await client.get(`${ROOT}/${track.id}`).expect(200)).body,
      ),
    ).toMatchObject({
      title: 'Locked recording',
      locked: true,
      notes: [],
    });
    await client.get(`${ROOT}/${track.id}/media/music`).expect(403);
  });

  it('completes accepted uploads after membership expires with attempt-isolated outputs', async () => {
    const owner = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    const processing = testApp.app.get(PrivateTrackProcessingService);
    const enqueue = vi
      .spyOn(processing, 'enqueue')
      .mockResolvedValue(undefined);
    const firstUpload = await client
      .post(ROOT)
      .attach('audio', FIXTURE, { filename: 'first.wav' })
      .expect(201);
    const secondUpload = await client
      .post(ROOT)
      .attach('audio', MP3_FIXTURE, { filename: 'second.mp3' })
      .expect(201);
    const firstTrackId = firstUpload.body.id as string;
    const secondTrackId = secondUpload.body.id as string;
    enqueue.mockRestore();

    fakeDetector.startJob.mockImplementationOnce(async (input) => {
      const jobId = `accepted-response-lost-${input.processingId}`;
      detectorInputs.set(jobId, input);
      throw new Error('RunPod accepted the job but the response was lost');
    });
    await expect(
      processing.process({
        userId: owner.id,
        privateTrackId: firstTrackId,
        poll: 0,
      }),
    ).rejects.toThrow('response was lost');
    await processing.process({
      userId: owner.id,
      privateTrackId: firstTrackId,
      poll: 0,
    });
    await processing.process({
      userId: owner.id,
      privateTrackId: secondTrackId,
      poll: 0,
    });

    const firstLaunch = detectorInputs.get(
      `accepted-response-lost-${firstTrackId}`,
    );
    const firstRow = await testApp.app
      .get(PrivateTracksRepository)
      .findById(firstTrackId);
    const secondRow = await testApp.app
      .get(PrivateTracksRepository)
      .findById(secondTrackId);
    if (!firstLaunch || !firstRow?.processingAttemptId || !secondRow) {
      throw new Error('Expected detector launches and processing attempts');
    }
    const acceptedFirstLaunch = [...detectorInputs.entries()].find(
      ([jobId, input]) =>
        jobId !== `accepted-response-lost-${firstTrackId}` &&
        input.processingId === firstTrackId,
    )?.[1];
    if (!acceptedFirstLaunch || !secondRow.processingAttemptId) {
      throw new Error('Expected unique retry and second recording launches');
    }
    expect(acceptedFirstLaunch.vocalsUpload.publicUrl).not.toBe(
      firstLaunch.vocalsUpload.publicUrl,
    );
    expect(acceptedFirstLaunch.pitchCurveUpload.publicUrl).not.toBe(
      firstLaunch.pitchCurveUpload.publicUrl,
    );

    await testApp.db
      .update(subscriptions)
      .set({
        paidMembership: false,
      })
      .where(eq(subscriptions.userId, owner.id));
    expect(fakeDetector.startJob).toHaveBeenCalledTimes(3);

    await processing.process({
      userId: owner.id,
      privateTrackId: firstTrackId,
      attemptId: firstRow.processingAttemptId,
      poll: 1,
    });
    await processing.process({
      userId: owner.id,
      privateTrackId: secondTrackId,
      attemptId: secondRow.processingAttemptId,
      poll: 1,
    });

    const repository = testApp.app.get(PrivateTracksRepository);
    const firstNotes = await repository.listNotes(firstTrackId);
    const secondNotes = await repository.listNotes(secondTrackId);
    expect(firstNotes[0]?.pitch).not.toBe(secondNotes[0]?.pitch);
    for (const trackId of [firstTrackId, secondTrackId]) {
      const detail = privateTrackDetailSchema.parse(
        (await client.get(`${ROOT}/${trackId}`).expect(200)).body,
      );
      expect(detail.processing.status).toBe('COMPLETED');
      expect(detail.locked).toBe(true);
      expect(detail.notes).toEqual([]);
    }
  });

  it('marks the claimed attempt failed after its final launch failure', async () => {
    const owner = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    const processing = testApp.app.get(PrivateTrackProcessingService);
    const enqueue = vi
      .spyOn(processing, 'enqueue')
      .mockResolvedValue(undefined);
    const uploaded = await client
      .post(ROOT)
      .attach('audio', FIXTURE, { filename: 'failed-launch.wav' })
      .expect(201);
    enqueue.mockRestore();
    const processor = new PrivateTrackProcessingProcessor(
      processing,
      {} as never,
    );
    fakeDetector.startJob.mockRejectedValueOnce(
      new Error('RunPod launch unavailable'),
    );

    await expect(
      processor.process({
        name: PROCESS_PRIVATE_TRACK_JOB,
        data: {
          privateTrackId: uploaded.body.id as string,
          userId: owner.id,
          poll: 0,
        },
        attemptsMade: 0,
        opts: { attempts: 1 },
      } as Job<unknown>),
    ).rejects.toThrow('Private track processing attempt failed');

    const failed = await testApp.app
      .get(PrivateTracksRepository)
      .findById(uploaded.body.id as string);
    expect(failed?.processingStatus).toBe('FAILED');
    expect(failed?.processingAttemptId).not.toBeNull();
  });
});

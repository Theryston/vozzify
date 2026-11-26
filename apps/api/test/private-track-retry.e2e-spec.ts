import { fileURLToPath } from 'node:url';
import {
  privateTrackDetailSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import { FfmpegClient } from '../src/integrations/ffmpeg/ffmpeg.client.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../src/integrations/note-detection/note-detection.client.js';
import type { RunpodJobState } from '../src/integrations/note-detection/runpod-job.js';
import {
  PRIVATE_TRACK_PROCESSING_QUEUE,
  PROCESS_PRIVATE_TRACK_JOB,
  processPrivateTrackJobSchema,
} from '../src/modules/private-tracks/private-track-processing.job.js';
import { PrivateTrackProcessingService } from '../src/modules/private-tracks/private-track-processing.service.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { billingCatalog } from './utils/billing-fixture.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createPasswordUser, DEFAULT_PASSWORD } from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';

const AUDIO = fileURLToPath(
  new URL('../../web/e2e/fixtures/a4-440hz.wav', import.meta.url),
);
const TRACKS = '/v1/me/private-tracks';
const NOTES = [{ pitch: 69, start: 0.1, end: 0.4 }];

describe('Private track retry (e2e)', () => {
  let testApp: TestApp;
  let catalog: Awaited<ReturnType<typeof startFakeMusicCatalog>>;
  const detector = {
    startJob: vi.fn<(input: NoteDetectionInput) => Promise<string>>(),
    checkJob: vi.fn<(jobId: string) => Promise<RunpodJobState>>(),
  };

  beforeAll(async () => {
    catalog = await startFakeMusicCatalog(() => ({ result: { results: [] } }));
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      },
      override: (builder) =>
        builder.overrideProvider(NoteDetectionClient).useValue(detector),
    });
  });

  afterAll(async () => {
    await testApp?.close();
    await catalog?.close();
  });

  async function proOwner() {
    const user = await createPasswordUser(testApp.db);
    await testApp.db.insert(subscriptions).values({
      userId: user.id,
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
    const client = createAuthClient(testApp);
    await signIn(client, { email: user.email, password: DEFAULT_PASSWORD });
    return { user, client };
  }

  function queuedJobs() {
    const queue = testApp.queues[PRIVATE_TRACK_PROCESSING_QUEUE];
    if (!queue) throw new Error('Expected a private Track queue');
    return queue.added
      .filter(({ name }) => name === PROCESS_PRIVATE_TRACK_JOB)
      .map(({ data }) => processPrivateTrackJobSchema.parse(data));
  }

  it('recovers the same track after failure with one retry and retained audio', async () => {
    await resetDatabase(testApp.db);
    await billingCatalog(testApp);
    const { user, client } = await proOwner();
    const other = await proOwner();
    const processing = testApp.app.get(PrivateTrackProcessingService);
    const invalidId = await client
      .post(`${TRACKS}/${'x'.repeat(129)}/retry`)
      .expect(400);
    expect(invalidId.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { location: 'param' },
    });
    const upload = await client
      .post(TRACKS)
      .attach('audio', AUDIO, { filename: 'rehearsal.wav' })
      .expect(201);
    const path = `${TRACKS}/${privateTrackSchema.parse(upload.body).id}`;
    const [firstStart] = queuedJobs();
    detector.startJob.mockResolvedValueOnce('original-job');
    detector.checkJob.mockResolvedValueOnce({ kind: 'failed' });
    await processing.process(firstStart);
    const [, firstPoll] = queuedJobs();
    await processing.process(firstPoll);

    const failed = privateTrackDetailSchema.parse(
      (await client.get(path).expect(200)).body,
    );
    expect(failed.processing).toEqual({ status: 'FAILED', progress: 0 });
    expect((await client.get(TRACKS).expect(200)).body.items).toMatchObject([
      { id: failed.id, processing: { status: 'FAILED' } },
    ]);
    await other.client.post(`${path}/retry`).expect(404);
    await testApp.http.post(`${path}/retry`).expect(401);
    const membership = (paidMembership: boolean) =>
      testApp.db
        .update(subscriptions)
        .set({ paidMembership })
        .where(eq(subscriptions.userId, user.id));
    await membership(false);
    await client.post(`${path}/retry`).expect(403);
    await membership(true);

    const responses = await Promise.all([
      client.post(`${path}/retry`).expect(202),
      client.post(`${path}/retry`).expect(202),
    ]);
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).toEqual({ status: 'QUEUED', progress: 0 });
    }
    const starts = queuedJobs().filter(({ poll }) => poll === 0);
    expect(starts).toHaveLength(2);
    const [, retryStart] = starts;

    detector.startJob.mockResolvedValueOnce('retry-job');
    vi.spyOn(
      testApp.app.get(FfmpegClient),
      'convertPrivateAudioFileToWav',
    ).mockRejectedValue(new Error('FFmpeg is unavailable for this retry'));
    await processing.process(firstStart);
    await processing.process(firstPoll);
    await processing.process(retryStart);
    expect(detector.startJob).toHaveBeenCalledTimes(2);
    const [originalCall, retryCall] = detector.startJob.mock.calls;
    if (!originalCall || !retryCall) throw new Error('Expected detector jobs');
    const [original] = originalCall;
    const [retried] = retryCall;
    expect(new URL(retried.musicUrl).pathname).toBe(
      new URL(original.musicUrl).pathname,
    );
    expect(retried.vocalsUpload.publicUrl).not.toBe(
      original.vocalsUpload.publicUrl,
    );
    detector.checkJob.mockResolvedValueOnce({
      kind: 'completed',
      output: {
        vocalsUrl: retried.vocalsUpload.publicUrl,
        pitchCurveUrl: retried.pitchCurveUpload.publicUrl,
        detectorVersion: 'retry-e2e',
        notes: NOTES,
      },
    });
    await processing.process(queuedJobs().at(-1));
    expect((await client.get(path).expect(200)).body).toMatchObject({
      id: failed.id,
      title: failed.title,
      artist: failed.artist,
      processing: { status: 'COMPLETED', progress: 100 },
      notes: NOTES,
    });
    await client
      .get(`${path}/media/music`)
      .set('Range', 'bytes=0-3')
      .expect(206);
  });
});

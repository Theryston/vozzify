import { readFile } from 'node:fs/promises';
import {
  myPrivateTracksPageSchema,
  privateTrackDetailSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import type { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../src/integrations/note-detection/note-detection.client.js';
import { YouTubeMusicClient } from '../src/integrations/youtube-music/youtube-music.client.js';
import {
  PRIVATE_TRACK_PROCESSING_QUEUE,
  PROCESS_PRIVATE_TRACK_JOB,
  processPrivateTrackJobSchema,
} from '../src/modules/private-tracks/private-track-processing.job.js';
import { PrivateTrackProcessingProcessor } from '../src/modules/private-tracks/private-track-processing.processor.js';
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
import { youtubeVideo } from './utils/fake-youtube-music.js';

const ROOT = '/v1/me/private-tracks';
const VIDEO_ID = 'aBcd1Efgh_2';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const SHARE_URL = `https://youtu.be/${VIDEO_ID}?si=example`;
const VIDEO_TITLE = 'Guitar rehearsal in São Paulo';
const DOWNLOAD_FIXTURE = new URL('./fixtures/tone.mp3', import.meta.url);

const getPracticeVideo = vi.fn();
const downloadAudio = vi.fn();
const startJob = vi.fn(
  async (_input: NoteDetectionInput) => 'private-youtube-job',
);
const checkJob = vi.fn();

describe('Private YouTube tracks (e2e)', () => {
  let app: TestApp;
  let catalog: Awaited<ReturnType<typeof startFakeMusicCatalog>>;

  beforeAll(async () => {
    catalog = await startFakeMusicCatalog(() => ({ result: { results: [] } }));
    app = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      },
      override: (builder) =>
        builder
          .overrideProvider(YouTubeMusicClient)
          .useValue({ getPracticeVideo, downloadAudio })
          .overrideProvider(NoteDetectionClient)
          .useValue({ startJob, checkJob }),
    });
  });

  afterAll(async () => {
    await app.close();
    await catalog.close();
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    getPracticeVideo.mockResolvedValue(
      youtubeVideo({
        videoId: VIDEO_ID,
        title: VIDEO_TITLE,
        durationSeconds: 2,
      }),
    );
    await resetDatabase(app.db);
    await billingCatalog(app);
  });

  async function signInUser(pro = true) {
    const user = await createPasswordUser(app.db);
    if (pro) {
      await app.db.insert(subscriptions).values({
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
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      });
    }
    const client = createAuthClient(app);
    await signIn(client, { email: user.email, password: DEFAULT_PASSWORD });
    return { client, user };
  }

  it('canonicalizes concurrent submissions and keeps identical videos separate across owners', async () => {
    const owner = await signInUser();
    const other = await signInUser();
    const accepted = await Promise.all(
      [WATCH_URL, SHARE_URL].map((url) =>
        owner.client.post(`${ROOT}/youtube`).send({ url }).expect(201),
      ),
    );
    const [first, duplicate] = accepted.map((response) =>
      privateTrackSchema.parse(response.body),
    );
    expect(first).toMatchObject({
      title: VIDEO_TITLE,
      artist: '',
      durationMs: 2_000,
      processing: { status: 'QUEUED', progress: 0 },
    });
    expect(duplicate?.id).toBe(first?.id);
    const listing = await owner.client.get(ROOT).expect(200);
    expect(myPrivateTracksPageSchema.parse(listing.body).items).toHaveLength(1);

    getPracticeVideo.mockClear();
    const existing = await owner.client
      .post(`${ROOT}/youtube`)
      .send({ url: WATCH_URL })
      .expect(201);
    expect(privateTrackSchema.parse(existing.body).id).toBe(first?.id);
    expect(getPracticeVideo).not.toHaveBeenCalled();

    const another = await other.client
      .post(`${ROOT}/youtube`)
      .send({ url: SHARE_URL })
      .expect(201);
    expect(privateTrackSchema.parse(another.body).id).not.toBe(first?.id);
    await other.client.get(`${ROOT}/${first?.id}`).expect(404);
  });

  it('requires Pro and rejects non-video URLs and videos longer than 30 minutes', async () => {
    const free = await signInUser(false);
    await request(app.app.getHttpServer())
      .post(`${ROOT}/youtube`)
      .send({ url: SHARE_URL })
      .expect(401);
    await free.client
      .post(`${ROOT}/youtube`)
      .send({ url: SHARE_URL })
      .expect(403);

    const owner = await signInUser();
    for (const url of [
      'https://www.youtube.com/playlist?list=example',
      `https://youtube.com.example.org/watch?v=${VIDEO_ID}`,
      `ftp://www.youtube.com/watch?v=${VIDEO_ID}`,
    ]) {
      const invalid = await owner.client
        .post(`${ROOT}/youtube`)
        .send({ url })
        .expect(400);
      expect(invalid.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { location: 'body', issues: [{ path: ['url'] }] },
      });
    }
    expect(getPracticeVideo).not.toHaveBeenCalled();
    getPracticeVideo.mockResolvedValueOnce(
      youtubeVideo({ videoId: VIDEO_ID, durationSeconds: 1_801 }),
    );
    await owner.client
      .post(`${ROOT}/youtube`)
      .send({ url: SHARE_URL })
      .expect(400);
    getPracticeVideo.mockResolvedValueOnce(
      youtubeVideo({ videoId: VIDEO_ID, durationSeconds: 1_800 }),
    );
    await owner.client
      .post(`${ROOT}/youtube`)
      .send({ url: SHARE_URL })
      .expect(201);
  });

  it('retains audio and notes for the submitted video and requires current ownership and Pro for playback', async () => {
    const owner = await signInUser();
    const other = await signInUser();
    const submitted = await owner.client
      .post(`${ROOT}/youtube`)
      .send({ url: SHARE_URL })
      .expect(201);
    const { id } = privateTrackSchema.parse(submitted.body);
    const bytes = await readFile(DOWNLOAD_FIXTURE);
    downloadAudio.mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    );
    await runProcessing(id);
    expect(downloadAudio).toHaveBeenCalledWith(
      VIDEO_ID,
      expect.any(AbortSignal),
    );
    const detectorInput = startJob.mock.calls[0]?.[0];
    if (!detectorInput) throw new Error('Expected a detector request');
    checkJob.mockResolvedValue({
      kind: 'completed',
      output: {
        vocalsUrl: detectorInput.vocalsUpload.publicUrl,
        pitchCurveUrl: detectorInput.pitchCurveUpload.publicUrl,
        detectorVersion: 'fake-youtube-e2e',
        notes: [{ pitch: 69, start: 0.2, end: 0.7 }],
      },
    });
    await runProcessing(id);

    const detail = await owner.client.get(`${ROOT}/${id}`).expect(200);
    expect(privateTrackDetailSchema.parse(detail.body)).toMatchObject({
      youtubeVideoId: VIDEO_ID,
      notes: [{ pitch: 69, start: 0.2, end: 0.7 }],
      processing: { status: 'COMPLETED', progress: 100 },
    });
    const media = `${ROOT}/${id}/media/music`;
    await request(app.app.getHttpServer()).get(media).expect(401);
    await other.client.get(media).expect(404);
    const playback = await owner.client
      .get(media)
      .set('Range', 'bytes=0-11')
      .expect(206);
    expect(playback.headers['cache-control']).toBe('private, no-store');
    expect(playback.headers['content-type']).toMatch(/^audio\/wav/);
    expect(playback.headers['content-range']).toMatch(/^bytes 0-11\//);
    await app.db
      .update(subscriptions)
      .set({ currentPeriodEnd: new Date(0) })
      .where(eq(subscriptions.userId, owner.user.id));
    await owner.client.get(media).expect(403);
    const locked = await owner.client.get(`${ROOT}/${id}`).expect(200);
    expect(
      privateTrackDetailSchema.parse(locked.body).youtubeVideoId,
    ).toBeUndefined();
  });

  it('keeps the entry with a failed Processing when the video download fails', async () => {
    const owner = await signInUser();
    const submitted = await owner.client
      .post(`${ROOT}/youtube`)
      .send({ url: SHARE_URL })
      .expect(201);
    const { id } = privateTrackSchema.parse(submitted.body);
    downloadAudio.mockRejectedValue(new Error('YouTube download unavailable'));
    await expect(runProcessing(id)).rejects.toThrow(
      'YouTube download unavailable',
    );
    const detail = await owner.client.get(`${ROOT}/${id}`).expect(200);
    expect(privateTrackDetailSchema.parse(detail.body).processing.status).toBe(
      'FAILED',
    );
    expect(startJob).not.toHaveBeenCalled();
    await owner.client.get(`${ROOT}/${id}/media/music`).expect(404);
  });

  function runProcessing(privateTrackId: string) {
    const queue = app.queues[PRIVATE_TRACK_PROCESSING_QUEUE];
    const queued = queue?.added.findLast(
      ({ name, data }) =>
        name === PROCESS_PRIVATE_TRACK_JOB &&
        processPrivateTrackJobSchema.safeParse(data).data?.privateTrackId ===
          privateTrackId,
    );
    if (!queue || !queued)
      throw new Error('Expected queued private Processing');
    const processor = new PrivateTrackProcessingProcessor(
      app.app.get(PrivateTrackProcessingService),
      queue as unknown as Queue,
    );
    return processor.process({
      ...queued,
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as Job);
  }
});

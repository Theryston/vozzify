import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
  myPrivateTracksPageSchema,
  privateTrackDetailSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import request from 'supertest';
import { inject } from 'vitest';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../src/integrations/note-detection/note-detection.client.js';
import {
  PRIVATE_TRACK_PROCESSING_QUEUE,
  PROCESS_PRIVATE_TRACK_JOB,
} from '../src/modules/private-tracks/private-track-processing.job.js';
import { PrivateTrackProcessingService } from '../src/modules/private-tracks/private-track-processing.service.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { billingCatalog } from './utils/billing-fixture.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createPasswordUser, DEFAULT_PASSWORD } from './utils/factories.js';

const VIDEO = fileURLToPath(
  new URL('./fixtures/private-rehearsal.mp4', import.meta.url),
);
const ROOT = '/v1/me/private-tracks';
const NOTE = { pitch: 69, start: 0.1, end: 0.3 };
const run = promisify(execFile);

describe('Private video uploads (e2e)', () => {
  let testApp: TestApp;
  let detectorInput: NoteDetectionInput | undefined;
  let detectedMusic: Buffer | undefined;

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(NoteDetectionClient).useValue({
          startJob: async (input: NoteDetectionInput) => {
            detectorInput = input;
            const response = await fetch(input.musicUrl);
            if (!response.ok) throw new Error('Failed to fetch detector input');
            detectedMusic = Buffer.from(await response.arrayBuffer());
            return 'private-video-notes';
          },
          checkJob: async () => ({
            kind: 'completed',
            output: {
              vocalsUrl: detectorInput?.vocalsUpload.publicUrl,
              pitchCurveUrl: detectorInput?.pitchCurveUpload.publicUrl,
              detectorVersion: 'private-video-e2e',
              notes: [NOTE],
            },
          }),
        }),
    });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(async () => {
    detectorInput = undefined;
    detectedMusic = undefined;
    await resetDatabase(testApp.db);
    await billingCatalog(testApp);
  });

  const createProClient = async () => {
    const owner = await createPasswordUser(testApp.db);
    await testApp.db.insert(subscriptions).values({
      userId: owner.id,
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
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    return { owner, client };
  };

  it('retains only private audio from the video and uses it for both notes and playback', async () => {
    const { owner, client } = await createProClient();
    const other = await createProClient();
    const jobs = testApp.queues[PRIVATE_TRACK_PROCESSING_QUEUE]?.added;
    if (!jobs) throw new Error('Expected the private Processing queue');
    const uploadJobIndex = jobs.length;
    const duplicateUploads = await Promise.all([
      client.post(ROOT).attach('audio', VIDEO, 'filmed rehearsal.mp4'),
      client.post(ROOT).attach('audio', VIDEO, 'filmed rehearsal.mp4'),
    ]);
    const entries = duplicateUploads.map((response) => {
      expect(response.status).toBe(201);
      return privateTrackSchema.parse(response.body);
    });
    const entry = entries[0];
    if (!entry) throw new Error('Expected the uploaded private track');
    expect(entries[1]?.id).toBe(entry.id);
    expect(entry).toMatchObject({
      title: 'filmed rehearsal.mp4',
      artist: '',
      processing: { status: 'QUEUED', progress: 0 },
    });
    const sameFileOtherOwner = await other.client
      .post(ROOT)
      .attach('audio', VIDEO, 'filmed rehearsal.mp4')
      .expect(201);
    expect(privateTrackSchema.parse(sameFileOtherOwner.body).id).not.toBe(
      entry.id,
    );

    expect(await listPrivateObjects(owner.id)).toHaveLength(1);
    const processing = testApp.app.get(PrivateTrackProcessingService);
    const start = jobs[uploadJobIndex];
    if (start?.name !== PROCESS_PRIVATE_TRACK_JOB) {
      throw new Error('Expected a Processing start from the upload');
    }
    const pollJobIndex = jobs.length;
    await processing.process(start.data);
    const poll = jobs
      .slice(pollJobIndex)
      .find(({ name }) => name === PROCESS_PRIVATE_TRACK_JOB);
    if (!poll) throw new Error('Expected a Note detection poll');
    await processing.process(poll.data);

    const detail = await client.get(`${ROOT}/${entry.id}`).expect(200);
    expect(privateTrackDetailSchema.parse(detail.body)).toMatchObject({
      processing: { status: 'COMPLETED', progress: 100 },
      notes: [NOTE],
    });
    const mediaPath = `${ROOT}/${entry.id}/media/music`;
    const response = await client.get(mediaPath).expect(200);
    expect(response.headers['content-type']).toBe('audio/wav');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual(detectedMusic);
    expect(detectedMusic?.toString('ascii', 0, 4)).toBe('RIFF');
    expect(detectedMusic?.toString('ascii', 8, 12)).toBe('WAVE');
    expect(await listPrivateObjects(owner.id)).toHaveLength(1);
    await other.client.get(mediaPath).expect(404);
    await request(testApp.app.getHttpServer()).get(mediaPath).expect(401);
  }, 30_000);

  it('requires audio and applies the inclusive duration limit to the whole video', async () => {
    const { owner, client } = await createProClient();
    const directory = await mkdtemp(join(tmpdir(), 'private-video-limits-'));
    try {
      const videoOnly = join(directory, 'no-audio.mp4');
      const atLimit = join(directory, 'at-limit.mov');
      const longVideo = join(directory, 'too-long.mov');
      await createVideo(videoOnly, 1);
      await createVideo(atLimit, 1_800, 1);
      await createVideo(longVideo, 1_801, 1);

      const noAudio = await client
        .post(ROOT)
        .attach('audio', videoOnly)
        .expect(400);
      expect(noAudio.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: {
          location: 'body',
          issues: [
            {
              code: 'custom',
              path: ['audio'],
              params: { reason: 'MISSING_VIDEO_AUDIO' },
            },
          ],
        },
      });
      await client.post(ROOT).attach('audio', longVideo).expect(400);
      await client
        .post(ROOT)
        .attach('audio', Buffer.from('not a media file'), 'corrupt.mp4')
        .expect(400);
      const listed = await client.get(ROOT).expect(200);
      expect(myPrivateTracksPageSchema.parse(listed.body).items).toEqual([]);
      expect(await listPrivateObjects(owner.id)).toEqual([]);
      const accepted = await client
        .post(ROOT)
        .attach('audio', atLimit)
        .expect(201);
      expect(privateTrackSchema.parse(accepted.body).durationMs).toBe(1000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

async function createVideo(
  output: string,
  videoSeconds: number,
  audioSeconds?: number,
) {
  const audio = audioSeconds
    ? [
        '-f',
        'lavfi',
        '-i',
        `sine=f=440:r=8000:d=${audioSeconds}`,
        '-c:a',
        'pcm_s16le',
      ]
    : ['-an'];
  await run('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=s=16x16:r=1:d=${videoSeconds}`,
    ...audio,
    '-c:v',
    'mpeg4',
    output,
  ]);
}

async function listPrivateObjects(ownerId: string) {
  const { endpoint, region, accessKeyId, secretAccessKey, bucket } =
    inject('storage');
  const storage = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  try {
    const result = await storage.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `private-tracks/${ownerId}/`,
      }),
    );
    return result.Contents ?? [];
  } finally {
    storage.destroy();
  }
}

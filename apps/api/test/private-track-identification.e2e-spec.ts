import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateTrackDetailSchema, type Recording } from '@vozzify/contracts';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../src/integrations/note-detection/note-detection.client.js';
import { YouTubeMusicClient } from '../src/integrations/youtube-music/youtube-music.client.js';
import { PRIVATE_TRACK_IDENTIFICATION_QUEUE } from '../src/modules/private-tracks/private-track-identification.job.js';
import { PrivateTrackIdentificationProcessor } from '../src/modules/private-tracks/private-track-identification.processor.js';
import { PrivateTrackIdentificationService } from '../src/modules/private-tracks/private-track-identification.service.js';
import { PRIVATE_TRACK_PROCESSING_QUEUE } from '../src/modules/private-tracks/private-track-processing.job.js';
import { PrivateTrackProcessingService } from '../src/modules/private-tracks/private-track-processing.service.js';
import { type AuthClient, createAuthClient } from './utils/auth.js';
import { billingCatalog, billingUser } from './utils/billing-fixture.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createTrack, testMbid } from './utils/factories.js';
import {
  FAKE_CATALOG_API_KEY,
  startFakeMusicCatalog,
} from './utils/fake-music-catalog.js';
import { youtubeVideo } from './utils/fake-youtube-music.js';
import { pcmWavHeader } from './utils/pcm-wav-fixture.js';

const ROOT = '/v1/me/private-tracks';
const APP_KEY = 'fixture-acoustid-commercial-key';
const STUDIO = testMbid(55201);
const LIVE = testMbid(55202);
const UNKNOWN = testMbid(55203);
const WRONG_LENGTH = testMbid(55204);
const SOURCE = 'Ensaio particular.wav';
const VIDEO_ID = 'aBcd1Efgh_2';
const VIDEO_TITLE = 'Private rehearsal from YouTube';
const NOTE = { pitch: 64, start: 0.4, end: 1.2 };

function makeRecording(
  mbid: string,
  title: string,
  lengthMs = 8_000,
): Recording {
  return {
    mbid,
    title,
    lengthMs,
    disambiguation: '',
    video: false,
    isrcs: [],
    artistCredit: { name: 'Trio do Bairro', artists: [] },
    releases: [],
    works: [],
    genres: [],
    tags: [],
    tagsSource: null,
    externalUrls: [],
  };
}
const studio = makeRecording(STUDIO, 'Noite de Samba (estúdio)');
const live = makeRecording(LIVE, 'Noite de Samba (ao vivo)');
const tooLong = makeRecording(
  WRONG_LENGTH,
  'Noite de Samba (versão longa)',
  180_000,
);
const hits = (
  ...groups: { score: number; recordings: { id: string }[] }[]
) => ({ status: 'ok', results: groups });
const group = (score: number, ...ids: string[]) => ({
  score,
  recordings: ids.map((id) => ({ id })),
});

/** An eight-second pitched rhythm with a changing envelope. */
function recognitionWav(): Buffer {
  const sampleRate = 22_050;
  const samples = sampleRate * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  const header = pcmWavHeader(wav.length, sampleRate, 1);
  header.copy(wav);
  for (let index = 0; index < samples; index += 1) {
    const phase = (2 * Math.PI * index) / sampleRate;
    const envelope = 0.6 + 0.3 * Math.sin(6 * phase);
    const sample = Math.round(14_000 * Math.sin(660 * phase) * envelope);
    wav.writeInt16LE(sample, header.length + index * 2);
  }
  return wav;
}

function fakeYouTubeAudio() {
  return {
    async getPracticeVideo(videoId: string) {
      return videoId === VIDEO_ID
        ? youtubeVideo({ videoId, title: VIDEO_TITLE, durationSeconds: 8 })
        : null;
    },
    async downloadAudio(videoId: string) {
      if (videoId !== VIDEO_ID) throw new Error('Unexpected YouTube video');
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(recognitionWav());
          controller.close();
        },
      });
    },
  };
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fakeAcoustid() {
  let respond = async () => ({ status: 200, body: hits(group(0.99, STUDIO)) });
  const requests: {
    keys: string[];
    fingerprint: string | null;
    duration: string | null;
    credentials: unknown[];
  }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const params = new URLSearchParams(body);
    requests.push({
      keys: [...params.keys()].sort(),
      fingerprint: params.get('fingerprint'),
      duration: params.get('duration'),
      credentials: [
        req.headers['acoustid-app-key'],
        req.headers['acoustid-user-key'],
        req.headers.cookie,
        req.headers.authorization,
      ],
    });
    const response = await respond();
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('AcoustID test server is not listening');
  return {
    url: `http://127.0.0.1:${address.port}/v2/lookup`,
    requests,
    setResponse: (next: typeof respond) => {
      respond = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function proOwner(app: TestApp) {
  const account = await billingUser(app);
  await app.db.insert(subscriptions).values({
    userId: account.user.id,
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
  return account;
}

function queuedJob(app: TestApp, queue: string) {
  const job = app.queues[queue]?.added.at(-1);
  if (!job) throw new Error(`Expected a job on ${queue}`);
  return job;
}

async function detail(client: AuthClient, id: string) {
  return privateTrackDetailSchema.parse(
    (await client.get(`${ROOT}/${id}`).expect(200)).body,
  );
}

describe('Private Recording identification and owner correction (API e2e)', () => {
  let app: TestApp;
  let directory: string;
  let mediaPath: string;
  let catalog: Awaited<ReturnType<typeof startFakeMusicCatalog>>;
  let provider: Awaited<ReturnType<typeof fakeAcoustid>>;
  let owner: Awaited<ReturnType<typeof proOwner>>;
  let other: Awaited<ReturnType<typeof proOwner>>;
  let publicTrack: Awaited<ReturnType<typeof createTrack>>;
  let id: string;
  const detectorInputs = new Map<string, NoteDetectionInput>();

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vozzify-test-fingerprint-'));
    mediaPath = join(directory, 'fixture.wav');
    await writeFile(mediaPath, recognitionWav());
    catalog = await startFakeMusicCatalog(({ mbid }) => {
      const result = [studio, live, tooLong].find(
        (recording) => recording.mbid === mbid,
      );
      return result
        ? { result }
        : {
            error: {
              code: 'RECORDING_NOT_FOUND',
              message: 'No such Recording',
            },
          };
    });
    provider = await fakeAcoustid();
    app = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        ACOUSTID_LOOKUP_URL: provider.url,
        ACOUSTID_COMMERCIAL_API_KEY: APP_KEY,
      },
      override: (builder) =>
        builder
          .overrideProvider(YouTubeMusicClient)
          .useValue(fakeYouTubeAudio())
          .overrideProvider(NoteDetectionClient)
          .useValue({
            async startJob(input: NoteDetectionInput) {
              detectorInputs.set(input.processingId, input);
              return input.processingId;
            },
            async checkJob(jobId: string) {
              const input = detectorInputs.get(jobId);
              if (!input) throw new Error('Expected a started detector job');
              return {
                kind: 'completed',
                output: {
                  vocalsUrl: input.vocalsUpload.publicUrl,
                  pitchCurveUrl: input.pitchCurveUpload.publicUrl,
                  detectorVersion: 'e2e-private-identification',
                  notes: [NOTE],
                },
              };
            },
          }),
    });
  });

  beforeEach(async () => {
    detectorInputs.clear();
    provider.requests.length = 0;
    provider.setResponse(async () => ({
      status: 200,
      body: hits(group(0.99, STUDIO)),
    }));
    await resetDatabase(app.db);
    await billingCatalog(app);
    owner = await proOwner(app);
    other = await proOwner(app);
    publicTrack = await createTrack(app.db, {
      recordingMbid: STUDIO,
      title: 'Public catalog title',
    });
    id = await submit(owner.client);
  });

  afterAll(async () => {
    await app?.close();
    await catalog?.close();
    await provider?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function submit(client: AuthClient): Promise<string> {
    const response = await client
      .post(ROOT)
      .attach('audio', mediaPath, { filename: SOURCE })
      .expect(201);
    const id = privateTrackDetailSchema.shape.id.parse(response.body.id);
    await runQueuedProcessing();
    return id;
  }

  async function runQueuedProcessing() {
    await app.app
      .get(PrivateTrackProcessingService)
      .process(queuedJob(app, PRIVATE_TRACK_PROCESSING_QUEUE).data);
  }

  function identify() {
    const processor = new PrivateTrackIdentificationProcessor(
      app.app.get(PrivateTrackIdentificationService),
    );
    return processor.process({
      ...queuedJob(app, PRIVATE_TRACK_IDENTIFICATION_QUEUE),
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as Job<unknown>);
  }

  it('links only the private metadata and allows practice before lookup finishes', async () => {
    const release = deferred();
    const started = deferred();
    provider.setResponse(async () => {
      started.resolve();
      await release.promise;
      return {
        status: 200,
        body: hits(group(0.98, STUDIO), group(0.86, LIVE)),
      };
    });
    const identification = identify();
    try {
      await Promise.race([started.promise, identification]);
      await runQueuedProcessing();
      const before = await detail(owner.client, id);
      expect(before).toMatchObject({
        title: SOURCE,
        artist: '',
        notes: [NOTE],
        processing: { status: 'COMPLETED' },
      });
      expect(before.recording).toBeUndefined();
      await owner.client.get(`${ROOT}/${id}/media/music`).expect(200);
    } finally {
      release.resolve();
      await identification;
    }
    expect(await detail(owner.client, id)).toMatchObject({
      title: studio.title,
      artist: studio.artistCredit.name,
      recording: { mbid: STUDIO },
      notes: [NOTE],
    });
    await app.http
      .get(`/v1/tracks/${publicTrack.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe(publicTrack.title);
      });
    const lookup = provider.requests[0];
    expect(lookup).toMatchObject({
      keys: ['duration', 'fingerprint', 'format', 'meta'],
      duration: '8',
      credentials: [APP_KEY, undefined, undefined, undefined],
    });
    expect(lookup?.fingerprint).toMatch(/^[\w-]{10,}$/);
  });

  it.each([
    ['ambiguous (studio vs live)', [group(0.99, STUDIO), group(0.98, LIVE)]],
    ['weak (different take or cover)', [group(0.87, STUDIO)]],
    ['unknown to the Music catalog', [group(0.99, UNKNOWN)]],
    ['different duration (partial match)', [group(0.99, WRONG_LENGTH)]],
    ['empty', []],
  ])(
    'retains source metadata when the lookup is %s',
    async (_label, result) => {
      provider.setResponse(async () => ({
        status: 200,
        body: hits(...result),
      }));
      await identify();
      await runQueuedProcessing();
      const current = await detail(owner.client, id);
      expect(current).toMatchObject({
        title: SOURCE,
        artist: '',
        notes: [NOTE],
      });
      expect(current.recording).toBeUndefined();
    },
  );

  it('allows uninterrupted practice through an unavailable lookup', async () => {
    provider.setResponse(async () => ({ status: 503, body: hits() }));
    await expect(identify()).rejects.toThrow(
      'Private Recording identification failed',
    );
    await runQueuedProcessing();
    const current = await detail(owner.client, id);
    expect(current).toMatchObject({
      title: SOURCE,
      notes: [NOTE],
      processing: { status: 'COMPLETED' },
    });
    expect(current.recording).toBeUndefined();
  });

  it('restricts metadata changes to the active Pro owner', async () => {
    const path = `${ROOT}/${id}`;
    await other.client.patch(path).send({ title: 'Intruder' }).expect(404);
    await createAuthClient(app)
      .patch(path)
      .send({ title: 'Anonymous' })
      .expect(401);
    await app.db
      .update(subscriptions)
      .set({ paidMembership: false })
      .where(eq(subscriptions.userId, owner.user.id));
    await owner.client.patch(path).send({ title: 'Locked' }).expect(403);
  });

  it('keeps owner overrides and unlinking even when an automatic lookup is in flight', async () => {
    const path = `${ROOT}/${id}`;
    await owner.client.patch(path).send({}).expect(400);
    await owner.client.patch(path).send({ recordingMbid: UNKNOWN }).expect(404);
    const release = deferred();
    const started = deferred();
    provider.setResponse(async () => {
      started.resolve();
      await release.promise;
      return { status: 200, body: hits(group(0.99, STUDIO)) };
    });
    const identification = identify();
    try {
      await Promise.race([started.promise, identification]);
      const corrected = await owner.client
        .patch(path)
        .send({ recordingMbid: LIVE, title: 'Meu ensaio', artist: '' })
        .expect(200);
      expect(corrected.body).toMatchObject({
        title: 'Meu ensaio',
        artist: '',
        recording: { mbid: LIVE },
      });
      await owner.client.patch(path).send({ recordingMbid: null }).expect(200);
    } finally {
      release.resolve();
      await identification;
    }
    await runQueuedProcessing();
    const current = await detail(owner.client, id);
    expect(current).toMatchObject({
      title: 'Meu ensaio',
      artist: '',
      notes: [NOTE],
    });
    expect(current.recording).toBeUndefined();
  });

  describe('a private YouTube source', () => {
    let youtubeTrackId: string;

    beforeEach(async () => {
      const submitted = await owner.client
        .post(`${ROOT}/youtube`)
        .send({ url: `https://youtu.be/${VIDEO_ID}` })
        .expect(201);
      youtubeTrackId = privateTrackDetailSchema.shape.id.parse(
        submitted.body.id,
      );
      await runQueuedProcessing();
    });

    it('recognizes the retained audio while keeping video, notes and fallback playback private', async () => {
      expect(await detail(owner.client, youtubeTrackId)).toMatchObject({
        title: VIDEO_TITLE,
        youtubeVideoId: VIDEO_ID,
      });
      await identify();
      await runQueuedProcessing();
      expect(await detail(owner.client, youtubeTrackId)).toMatchObject({
        id: youtubeTrackId,
        title: studio.title,
        recording: { mbid: STUDIO },
        youtubeVideoId: VIDEO_ID,
        notes: [NOTE],
        processing: { status: 'COMPLETED' },
      });
      const mediaPath = `${ROOT}/${youtubeTrackId}/media/music`;
      await owner.client
        .get(mediaPath)
        .expect(200)
        .expect('content-type', /audio\/wav/);
      await other.client.get(mediaPath).expect(404);
      expect((await detail(owner.client, id)).recording).toBeUndefined();
    });
  });
});

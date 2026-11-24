import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  myPrivateTracksSchema,
  PRIVATE_AUDIO_MAX_BYTES,
  PRIVATE_AUDIO_MAX_DURATION_SECONDS,
  privateTrackSchema,
} from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { loadEnv } from '../src/config/env.js';
import { privateTracks } from '../src/database/schema/private-tracks.js';
import { StorageService } from '../src/integrations/storage/storage.service.js';
import { SubscriptionMembershipService } from '../src/modules/plans/subscription-membership.service.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createPasswordUser, DEFAULT_PASSWORD } from './utils/factories.js';

const FIXTURE = fileURLToPath(
  new URL('../../web/e2e/fixtures/a4-440hz.wav', import.meta.url),
);
const ROOT = '/v1/me/private-tracks';

describe('Private tracks (e2e)', () => {
  let testApp: TestApp;
  const paidUsers = new Set<string>();
  const hasPaidMembership = vi.fn((userId: string) =>
    Promise.resolve(paidUsers.has(userId)),
  );

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(SubscriptionMembershipService)
          .useValue({ hasPaidMembership }),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    paidUsers.clear();
    await resetDatabase(testApp.db);
  });

  it('requires a session and a Pro membership to submit audio', async () => {
    await request(testApp.app.getHttpServer()).get(ROOT).expect(401);
    const user = await createPasswordUser(testApp.db);
    const client = createAuthClient(testApp);
    await signIn(client, { email: user.email, password: DEFAULT_PASSWORD });
    const listed = await client.get(ROOT).expect(200);
    expect(myPrivateTracksSchema.parse(listed.body)).toEqual({
      canSubmit: false,
      tracks: [],
    });
    await client.post(ROOT).attach('audio', FIXTURE).expect(403);
  });

  it('accepts an audio source once, deduplicates concurrent copies, and keeps it private to its owner', async () => {
    const owner = await createPasswordUser(testApp.db);
    const other = await createPasswordUser(testApp.db);
    paidUsers.add(owner.id);
    paidUsers.add(other.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });

    const [first, duplicate] = await Promise.all([
      client
        .post(ROOT)
        .attach('audio', FIXTURE, { filename: 'fallback song.wav' }),
      client
        .post(ROOT)
        .attach('audio', FIXTURE, { filename: 'fallback song.wav' }),
    ]);
    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(201);
    const entry = privateTrackSchema.parse(first.body);
    expect(privateTrackSchema.parse(duplicate.body).id).toBe(entry.id);
    expect(entry).toMatchObject({
      title: 'fallback song.wav',
      artist: '',
      durationMs: 1000,
    });
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(
      await testApp.db
        .select()
        .from(privateTracks)
        .where(eq(privateTracks.userId, owner.id)),
    ).toHaveLength(1);

    const distinctAudio = Buffer.from(await readFile(FIXTURE));
    const finalByte = distinctAudio.length - 1;
    const sample = distinctAudio[finalByte];
    if (sample === undefined) throw new Error('Expected fixture audio bytes');
    distinctAudio[finalByte] = sample ^ 1;
    const distinct = await client
      .post(ROOT)
      .attach('audio', distinctAudio, { filename: 'different.wav' })
      .expect(201);
    expect(privateTrackSchema.parse(distinct.body).id).not.toBe(entry.id);

    const privateRow = (
      await testApp.db
        .select()
        .from(privateTracks)
        .where(eq(privateTracks.userId, owner.id))
    )[0];
    if (!privateRow) throw new Error('Expected the private audio row');
    const stored = testApp.app.get(StorageService);
    const directory = await mkdtemp(join(tmpdir(), 'private-audio-e2e-'));
    const downloaded = join(directory, 'audio.wav');
    try {
      await stored.downloadPrivateFile(privateRow.objectKey, downloaded);
      expect(await readFile(downloaded)).toEqual(await readFile(FIXTURE));
      const { S3_ENDPOINT } = loadEnv();
      const privateBucket = loadEnv().S3_PRIVATE_BUCKET ?? 'vozzify-private';
      const response = await fetch(
        `${S3_ENDPOINT}/${privateBucket}/${privateRow.objectKey}`,
      );
      expect(response.status).toBe(403);
      await response.body?.cancel();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    const otherClient = createAuthClient(testApp);
    await signIn(otherClient, {
      email: other.email,
      password: DEFAULT_PASSWORD,
    });
    const otherList = await otherClient.get(ROOT).expect(200);
    expect(myPrivateTracksSchema.parse(otherList.body).tracks).toHaveLength(0);
    const otherEntry = await otherClient
      .post(ROOT)
      .attach('audio', FIXTURE, { filename: 'fallback song.wav' })
      .expect(201);
    expect(privateTrackSchema.parse(otherEntry.body).id).not.toBe(entry.id);

    await request(testApp.app.getHttpServer())
      .get(`/v1/tracks/${entry.id}`)
      .expect(404);
  });

  it('accepts exact byte and duration limits and rejects values above them', async () => {
    const owner = await createPasswordUser(testApp.db);
    paidUsers.add(owner.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    const directory = await mkdtemp(join(tmpdir(), 'private-audio-limits-'));
    const maxBytesPath = join(directory, 'max-size.wav');
    const durationPath = join(directory, 'max-duration.wav');
    const longDurationPath = join(directory, 'over-duration.wav');
    const oversizedPath = join(directory, 'over-size.wav');
    try {
      await createSparsePcmWav(
        maxBytesPath,
        PRIVATE_AUDIO_MAX_BYTES,
        44_100,
        2,
      );
      await createSparsePcmWav(
        durationPath,
        44 + 16_000 * 2 * PRIVATE_AUDIO_MAX_DURATION_SECONDS,
        16_000,
        1,
      );
      await createSparsePcmWav(
        longDurationPath,
        44 + 16_000 * 2 * PRIVATE_AUDIO_MAX_DURATION_SECONDS + 2,
        16_000,
        1,
      );
      await createSparsePcmWav(
        oversizedPath,
        PRIVATE_AUDIO_MAX_BYTES + 4,
        44_100,
        2,
      );

      await client.post(ROOT).attach('audio', maxBytesPath).expect(201);
      await client.post(ROOT).attach('audio', durationPath).expect(201);
      await client.post(ROOT).attach('audio', longDurationPath).expect(400);
      await client.post(ROOT).attach('audio', oversizedPath).expect(400);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects invalid audio content and unsupported multipart fields', async () => {
    const owner = await createPasswordUser(testApp.db);
    paidUsers.add(owner.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    await client
      .post(ROOT)
      .attach('audio', Buffer.from('not an audio file'), 'broken.wav')
      .expect(400);
    await client
      .post(ROOT)
      .field('title', 'untrusted title')
      .attach('audio', FIXTURE)
      .expect(400);
  });
});

async function createSparsePcmWav(
  path: string,
  bytes: number,
  sampleRate: number,
  channels: number,
) {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = bytes - 44;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(bytes - 8, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  const file = await open(path, 'w');
  try {
    await file.write(header);
    await file.truncate(bytes);
  } finally {
    await file.close();
  }
}

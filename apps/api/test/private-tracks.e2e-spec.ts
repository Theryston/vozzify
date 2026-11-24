import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  myPrivateTracksPageSchema,
  PRIVATE_AUDIO_MAX_BYTES,
  PRIVATE_AUDIO_MAX_DURATION_SECONDS,
  privateTrackSchema,
} from '@vozzify/contracts';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { loadEnv } from '../src/config/env.js';
import { privateTracks } from '../src/database/schema/private-tracks.js';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import { StorageService } from '../src/integrations/storage/storage.service.js';
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
const WEBM_FIXTURE = fileURLToPath(
  new URL('./fixtures/untagged-short.webm', import.meta.url),
);
const ROOT = '/v1/me/private-tracks';

describe('Private tracks (e2e)', () => {
  let testApp: TestApp;
  let catalog: Awaited<ReturnType<typeof startFakeMusicCatalog>>;
  let catalogSeeded: boolean;

  beforeAll(async () => {
    catalog = await startFakeMusicCatalog(() => ({
      result: {
        results: [
          {
            mbid: '7f3c8a5d-441a-4e6a-9b7a-4fc21a9c9001',
            title: 'Public control song',
            artistCredit: 'Public artist',
            coverUrl: null,
            trackId: 'public-control-track',
          },
        ],
      },
    }));
    testApp = await createTestApp({
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      },
    });
  });

  afterAll(async () => {
    await testApp.close();
    await catalog.close();
  });

  beforeEach(async () => {
    catalogSeeded = false;
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

  const createProClient = async () => {
    const owner = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    return client;
  };

  it('requires a session and a Pro membership to submit audio', async () => {
    await request(testApp.app.getHttpServer()).get(ROOT).expect(401);
    const user = await createPasswordUser(testApp.db);
    const client = createAuthClient(testApp);
    await signIn(client, { email: user.email, password: DEFAULT_PASSWORD });
    const listed = await client.get(ROOT).expect(200);
    expect(myPrivateTracksPageSchema.parse(listed.body)).toEqual({
      canSubmit: false,
      items: [],
      nextCursor: null,
    });
    await client.post(ROOT).attach('audio', FIXTURE).expect(403);
  });

  it('accepts an audio source once, deduplicates concurrent copies, and keeps it private to its owner', async () => {
    const owner = await createPasswordUser(testApp.db);
    const other = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    await grantPro(other.id);
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
        .where(eq(privateTracks.id, entry.id))
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
    expect(myPrivateTracksPageSchema.parse(otherList.body).items).toHaveLength(
      0,
    );
    const otherEntry = await otherClient
      .post(ROOT)
      .attach('audio', FIXTURE, { filename: 'fallback song.wav' })
      .expect(201);
    expect(privateTrackSchema.parse(otherEntry.body).id).not.toBe(entry.id);

    const publicSearch = await request(testApp.app.getHttpServer())
      .get('/v1/search')
      .query({ query: 'fallback song' })
      .expect(200);
    expect(publicSearch.body.results).toEqual([
      expect.objectContaining({ title: 'Public control song' }),
    ]);
    expect(JSON.stringify(publicSearch.body)).not.toContain('fallback song');
    await request(testApp.app.getHttpServer())
      .get(`/v1/tracks/${entry.id}`)
      .expect(404);
  });

  it('deletes one owner entry, denies cross-account deletion, and revokes its source and derivatives', async () => {
    const owner = await createPasswordUser(testApp.db);
    const other = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    await grantPro(other.id);
    const ownerClient = createAuthClient(testApp);
    const otherClient = createAuthClient(testApp);
    await signIn(ownerClient, {
      email: owner.email,
      password: DEFAULT_PASSWORD,
    });
    await signIn(otherClient, {
      email: other.email,
      password: DEFAULT_PASSWORD,
    });

    const created = await ownerClient
      .post(ROOT)
      .attach('audio', FIXTURE, { filename: 'owner-song.wav' })
      .expect(201);
    const entry = privateTrackSchema.parse(created.body);
    const differentAudio = Buffer.from(await readFile(FIXTURE));
    const lastByte = differentAudio.length - 1;
    const lastSample = differentAudio[lastByte];
    if (lastSample === undefined)
      throw new Error('Expected fixture audio bytes');
    differentAudio[lastByte] = lastSample ^ 1;
    await ownerClient
      .post(ROOT)
      .attach('audio', differentAudio, { filename: 'independent.wav' })
      .expect(201);
    await otherClient
      .post(ROOT)
      .attach('audio', FIXTURE, { filename: 'other-owner.wav' })
      .expect(201);

    await otherClient.delete(`${ROOT}/${entry.id}`).expect(404);
    expect(
      myPrivateTracksPageSchema.parse((await ownerClient.get(ROOT)).body).items,
    ).toHaveLength(2);

    const row = (
      await testApp.db
        .select()
        .from(privateTracks)
        .where(eq(privateTracks.id, entry.id))
    )[0];
    if (!row) throw new Error('Expected the private audio row');
    const storage = testApp.app.get(StorageService);
    const derivativeKey = `private-tracks/${owner.id}/${entry.id}/derivatives/vocals.wav`;
    await storage.putPrivateFile({
      key: derivativeKey,
      filePath: FIXTURE,
      contentType: 'audio/wav',
    });

    await ownerClient.delete(`${ROOT}/${entry.id}`).expect(204);
    const remaining = myPrivateTracksPageSchema.parse(
      (await ownerClient.get(ROOT).expect(200)).body,
    );
    expect(remaining.items).toHaveLength(1);

    const directory = await mkdtemp(join(tmpdir(), 'private-audio-deleted-'));
    try {
      await expect(
        storage.downloadPrivateFile(
          row.objectKey,
          join(directory, 'source.wav'),
        ),
      ).rejects.toThrow();
      await expect(
        storage.downloadPrivateFile(
          derivativeKey,
          join(directory, 'derivative.wav'),
        ),
      ).rejects.toThrow();

      const otherEntry = myPrivateTracksPageSchema.parse(
        (await otherClient.get(ROOT).expect(200)).body,
      ).items[0];
      if (!otherEntry) throw new Error('Expected other owner entry');
      const otherRow = (
        await testApp.db
          .select()
          .from(privateTracks)
          .where(eq(privateTracks.userId, other.id))
      )[0];
      if (!otherRow) throw new Error('Expected other owner private audio row');
      const otherDownload = join(directory, 'other-owner.wav');
      await storage.downloadPrivateFile(otherRow.objectKey, otherDownload);
      expect(await readFile(otherDownload)).toEqual(await readFile(FIXTURE));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // This real endpoint check sends a 250 MiB fixture through Supertest.
  it('accepts exact byte limit and rejects uploads above it', async () => {
    const client = await createProClient();
    const directory = await mkdtemp(join(tmpdir(), 'private-audio-limits-'));
    const maxBytesPath = join(directory, 'max-size.wav');
    const oversizedPath = join(directory, 'over-size.wav');
    try {
      await createSparsePcmWav(
        maxBytesPath,
        PRIVATE_AUDIO_MAX_BYTES,
        44_100,
        2,
      );
      await createSparsePcmWav(
        oversizedPath,
        PRIVATE_AUDIO_MAX_BYTES + 4,
        44_100,
        2,
      );

      await client.post(ROOT).attach('audio', maxBytesPath).expect(201);
      await client.post(ROOT).attach('audio', oversizedPath).expect(400);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('accepts exact duration limit and rejects audio above it', async () => {
    const client = await createProClient();
    const directory = await mkdtemp(join(tmpdir(), 'private-audio-duration-'));
    const durationPath = join(directory, 'max-duration.wav');
    const longDurationPath = join(directory, 'over-duration.wav');
    try {
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
      await client.post(ROOT).attach('audio', durationPath).expect(201);
      await client.post(ROOT).attach('audio', longDurationPath).expect(400);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('measures duration when a browser WebM has no container duration and decodes its filename', async () => {
    const owner = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    const response = await client
      .post(ROOT)
      .attach('audio', WEBM_FIXTURE, { filename: 'Canção de João.m4a' })
      .expect(201);
    expect(privateTrackSchema.parse(response.body)).toMatchObject({
      title: 'Canção de João.m4a',
      artist: '',
    });
  });

  it('paginates older private tracks with an opaque cursor', async () => {
    const owner = await createPasswordUser(testApp.db);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    const dates = [3, 2, 1].map(
      (day) => new Date(`2026-11-0${day}T00:00:00.000Z`),
    );
    await testApp.db.insert(privateTracks).values(
      dates.map((createdAt, index) => ({
        userId: owner.id,
        contentSha256: `hash-${index}`,
        objectKey: `${owner.id}/key-${index}`,
        originalFilename: `song-${index}.wav`,
        title: `Song ${index}`,
        artist: '',
        durationMs: 1000,
        createdAt,
      })),
    );

    const first = myPrivateTracksPageSchema.parse(
      (await client.get(ROOT).query({ limit: 2 }).expect(200)).body,
    );
    expect(first.items.map(({ title }) => title)).toEqual(['Song 0', 'Song 1']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = myPrivateTracksPageSchema.parse(
      (
        await client
          .get(ROOT)
          .query({ limit: 2, cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(second.items.map(({ title }) => title)).toEqual(['Song 2']);
    expect(second.nextCursor).toBeNull();
  });

  it('preserves pagination order for timestamps within the same millisecond', async () => {
    const owner = await createPasswordUser(testApp.db);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    const createdAt = new Date('2026-11-01T00:00:00.123Z');
    await testApp.db.insert(privateTracks).values([
      {
        id: 'tie-b',
        userId: owner.id,
        contentSha256: 'tie-b-hash',
        objectKey: `${owner.id}/tie-b`,
        originalFilename: 'tie-b.wav',
        title: 'Tie B',
        artist: '',
        durationMs: 1000,
        createdAt,
      },
      {
        id: 'tie-a',
        userId: owner.id,
        contentSha256: 'tie-a-hash',
        objectKey: `${owner.id}/tie-a`,
        originalFilename: 'tie-a.wav',
        title: 'Tie A',
        artist: '',
        durationMs: 1000,
        createdAt,
      },
    ]);
    await testApp.db.execute(sql`
      UPDATE private_tracks
      SET created_at = CASE id
        WHEN 'tie-b' THEN '2026-11-01T00:00:00.123900Z'::timestamptz
        ELSE '2026-11-01T00:00:00.123500Z'::timestamptz
      END
      WHERE id IN ('tie-b', 'tie-a')
    `);

    const first = myPrivateTracksPageSchema.parse(
      (await client.get(ROOT).query({ limit: 1 }).expect(200)).body,
    );
    const second = myPrivateTracksPageSchema.parse(
      (
        await client
          .get(ROOT)
          .query({ limit: 1, cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(first.items.map(({ id }) => id)).toEqual(['tie-b']);
    expect(second.items.map(({ id }) => id)).toEqual(['tie-a']);
  });

  it('rejects invalid audio content and unsupported multipart fields', async () => {
    const owner = await createPasswordUser(testApp.db);
    await grantPro(owner.id);
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

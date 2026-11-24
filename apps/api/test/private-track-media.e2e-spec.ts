import { fileURLToPath } from 'node:url';
import { privateTrackDetailSchema } from '@vozzify/contracts';
import request from 'supertest';
import {
  privateTrackNotes,
  privateTracks,
} from '../src/database/schema/private-tracks.js';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import { StorageService } from '../src/integrations/storage/storage.service.js';
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
const ROOT = '/v1/me/private-tracks';

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

  it('finds a pre-processing private row for bounded recovery without terminal rows', async () => {
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
    if (!queued || !completed) throw new Error('Expected private track rows');

    const candidates = await testApp.app
      .get(PrivateTracksRepository)
      .listQueued(100);

    expect(candidates.map((row) => row.id)).toContain(queued.id);
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
});

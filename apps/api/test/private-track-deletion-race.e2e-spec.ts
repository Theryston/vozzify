import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateTrackDetailSchema } from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import { privateTracks } from '../src/database/schema/private-tracks.js';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../src/integrations/note-detection/note-detection.client.js';
import { StorageService } from '../src/integrations/storage/storage.service.js';
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

const FIXTURE = fileURLToPath(
  new URL('../../web/e2e/fixtures/a4-440hz.wav', import.meta.url),
);
const ROOT = '/v1/me/private-tracks';
const fakeDetector = {
  startJob: vi.fn(async (_input: NoteDetectionInput) => 'unused-detector-job'),
  checkJob: vi.fn(async () => ({ kind: 'running' as const })),
};

describe('Private track deletion race (e2e)', () => {
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
    catalogSeeded = false;
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

  it('revokes an entry while RunPod is starting and preserves a same-source replacement', async () => {
    const owner = await createPasswordUser(testApp.db);
    const processing = testApp.app.get(PrivateTrackProcessingService);
    const enqueueSpy = vi
      .spyOn(processing, 'enqueue')
      .mockResolvedValue(undefined);
    await grantPro(owner.id);
    const client = createAuthClient(testApp);
    await signIn(client, { email: owner.email, password: DEFAULT_PASSWORD });
    const created = await client
      .post(ROOT)
      .attach('audio', FIXTURE, { filename: 'race.wav' })
      .expect(201);
    const entry = privateTrackDetailSchema
      .pick({ id: true })
      .parse(created.body);
    const oldRow = (
      await testApp.db
        .select()
        .from(privateTracks)
        .where(eq(privateTracks.id, entry.id))
    )[0];
    if (!oldRow) throw new Error('Expected the uploaded private track');

    const mediaKey = `private-tracks/${owner.id}/${entry.id}/media.wav`;
    const storage = testApp.app.get(StorageService);
    await storage.putPrivateFile({
      key: mediaKey,
      filePath: FIXTURE,
      contentType: 'audio/wav',
    });
    await testApp.db
      .update(privateTracks)
      .set({ mediaObjectKey: mediaKey, processingStatus: 'EXTRACTING_VOCALS' })
      .where(eq(privateTracks.id, entry.id));

    const detector = testApp.app.get(NoteDetectionClient);
    let releaseStart: (() => void) | undefined;
    let signalStart: (() => void) | undefined;
    const atDetector = new Promise<void>((resolve) => {
      signalStart = resolve;
    });
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let detectorInput:
      | Parameters<NoteDetectionClient['startJob']>[0]
      | undefined;
    const detectorSpy = vi
      .spyOn(detector, 'startJob')
      .mockImplementation(async (input) => {
        detectorInput = input;
        signalStart?.();
        await startGate;
        return 'late-runpod-job';
      });

    let activeJob: Promise<void> | undefined;
    try {
      activeJob = processing.process({
        userId: owner.id,
        privateTrackId: entry.id,
        poll: 0,
      });
      await atDetector;
      await client.delete(`${ROOT}/${entry.id}`).expect(204);

      const replacementResponse = await client
        .post(ROOT)
        .attach('audio', FIXTURE, { filename: 'replacement.wav' })
        .expect(201);
      const replacement = privateTrackDetailSchema
        .pick({ id: true })
        .parse(replacementResponse.body);
      expect(replacement.id).not.toBe(entry.id);

      releaseStart?.();
      await activeJob;
      if (!detectorInput) throw new Error('Expected detector upload URLs');
      const lateWrites = await Promise.all([
        fetch(detectorInput.vocalsUpload.presignedPutUrl, {
          method: 'PUT',
          headers: { 'content-type': detectorInput.vocalsUpload.contentType },
          body: await readFile(FIXTURE),
        }),
        fetch(detectorInput.pitchCurveUpload.presignedPutUrl, {
          method: 'PUT',
          headers: {
            'content-type': detectorInput.pitchCurveUpload.contentType,
          },
          body: Buffer.from('late pitch curve'),
        }),
      ]);
      expect(lateWrites.map((response) => response.status)).toEqual([200, 200]);

      await client.get(`${ROOT}/${entry.id}`).expect(404);
      await client.get(`${ROOT}/${entry.id}/media/music`).expect(404);
      const replacementRow = (
        await testApp.db
          .select()
          .from(privateTracks)
          .where(eq(privateTracks.id, replacement.id))
      )[0];
      if (!replacementRow) throw new Error('Expected replacement source row');
      const directory = await mkdtemp(
        join(tmpdir(), 'private-audio-replaced-'),
      );
      try {
        const replacementPath = join(directory, 'replacement.wav');
        await storage.downloadPrivateFile(
          replacementRow.objectKey,
          replacementPath,
        );
        expect(await readFile(replacementPath)).toEqual(
          await readFile(FIXTURE),
        );
        expect(oldRow.objectKey).not.toBe(replacementRow.objectKey);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } finally {
      releaseStart?.();
      detectorSpy.mockRestore();
      enqueueSpy.mockRestore();
      await activeJob?.catch(() => undefined);
    }
  });
});

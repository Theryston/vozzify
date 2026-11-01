import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { trackSearchIndexEvents } from '../src/database/schema/track-search-index-events.js';
import { tracks } from '../src/database/schema/tracks.js';
import { SonicService } from '../src/integrations/sonic/sonic.service.js';
import { TrackPipelineService } from '../src/modules/tracks/track-pipeline.service.js';
import { TrackSearchIndexService } from '../src/modules/tracks/track-search-index.service.js';
import { TrackSearchIndexEventRepository } from '../src/modules/tracks/track-search-index-event.repository.js';
import { DONE } from '../src/modules/tracks/track-step-outcome.js';
import { TrackStepsService } from '../src/modules/tracks/track-steps.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { createTrack } from './utils/factories.js';
import { createTrackProcessing } from './utils/track-processing-factories.js';

describe('Track Sonic index outbox (e2e)', () => {
  let testApp: TestApp;
  const replaceTrack = vi.fn().mockResolvedValue(undefined);
  const removeTrack = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    testApp = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(SonicService)
          .useValue({ replaceTrack, removeTrack })
          .overrideProvider(TrackStepsService)
          .useValue({ extractLyrics: vi.fn().mockResolvedValue(DONE) }),
    });
  });

  afterAll(async () => testApp.close());

  beforeEach(async () => {
    await resetDatabase(testApp.db);
    replaceTrack.mockReset().mockResolvedValue(undefined);
    removeTrack.mockReset().mockResolvedValue(undefined);
  });

  it('commits eligible work atomically with Processing completion', async () => {
    const track = await createTrack(testApp.db);
    const processing = await createTrackProcessing(testApp.db, track.id, {
      status: 'EXTRACTING_LYRICS',
    });
    expect(await testApp.db.select().from(trackSearchIndexEvents)).toEqual([]);

    await completeProcessingThroughPipeline(processing.id);

    const [completed] = await testApp.db
      .select({ status: trackProcessings.status })
      .from(trackProcessings)
      .where(eq(trackProcessings.id, processing.id));
    const [event] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, track.id));
    expect(completed?.status).toBe('COMPLETED');
    expect(event).toMatchObject({
      trackId: track.id,
      operation: 'upsert',
      searchableText: `${track.title} ${track.artistCredit
        .map(({ name, joinPhrase }) => `${name}${joinPhrase}`)
        .join('')}`,
      deliveredAt: null,
      revision: 1,
    });
  });

  it('rolls back Processing completion and its event together', async () => {
    const track = await createTrack(testApp.db);
    const processing = await createTrackProcessing(testApp.db, track.id, {
      status: 'EXTRACTING_LYRICS',
    });
    const transaction = testApp.app.get(TransactionHost);

    await expect(
      transaction.withTransaction(async () => {
        await completeProcessingThroughPipeline(processing.id);
        throw new Error('force transaction rollback');
      }),
    ).rejects.toThrow('force transaction rollback');

    const [unchanged] = await testApp.db
      .select({ status: trackProcessings.status })
      .from(trackProcessings)
      .where(eq(trackProcessings.id, processing.id));
    expect(unchanged?.status).toBe('EXTRACTING_LYRICS');
    expect(await testApp.db.select().from(trackSearchIndexEvents)).toEqual([]);
  });

  it('keeps newer projection work pending when an older delivery is acknowledged late', async () => {
    const track = await createTrack(testApp.db);
    const processing = await createTrackProcessing(testApp.db, track.id, {
      status: 'EXTRACTING_LYRICS',
    });
    await completeProcessingThroughPipeline(processing.id);
    const events = testApp.app.get(TrackSearchIndexEventRepository);
    const event = await testApp.db.query.trackSearchIndexEvents.findFirst({
      where: eq(trackSearchIndexEvents.trackId, track.id),
    });
    if (event === undefined) throw new Error('Expected pending index event');
    const delivery = testApp.app.get(TrackSearchIndexService);
    let signalSecondClaim: () => void = () => {};
    const secondClaimed = new Promise<void>((resolve) => {
      signalSecondClaim = resolve;
    });
    let releaseOldWrite: () => void = () => {};
    const oldWriteRelease = new Promise<void>((resolve) => {
      releaseOldWrite = resolve;
    });
    let claimCalls = 0;
    const claimPending = events.claimPending.bind(events);
    vi.spyOn(events, 'claimPending').mockImplementation(async (...args) => {
      const rows = await claimPending(...args);
      claimCalls += 1;
      if (claimCalls === 2 && rows.length > 0) signalSecondClaim();
      return rows;
    });
    let concurrentDelivery: Promise<number> | undefined;

    const cls = testApp.app.get(ClsService);
    replaceTrack.mockImplementationOnce(async () => {
      const newerTimestamp = new Date(event.sourceUpdatedAt.getTime() + 1_000);
      concurrentDelivery = cls.runWith({}, async () => {
        await testApp.db
          .update(tracks)
          .set({ updatedAt: newerTimestamp })
          .where(eq(tracks.id, track.id));
        await events.enqueueBackfillPage([
          {
            id: track.id,
            title: 'Updated title',
            artistCredit: track.artistCredit,
            updatedAt: newerTimestamp,
          },
        ]);
        return delivery.dispatchPending(new Date(Date.now() + 10_000));
      });
      await oldWriteRelease;
    });

    const firstDelivery = delivery.dispatchPending(
      new Date(event.nextAttemptAt.getTime() + 1),
    );
    await secondClaimed;
    expect(replaceTrack).toHaveBeenCalledOnce();
    releaseOldWrite();
    await firstDelivery;
    await concurrentDelivery;
    const [pending] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, track.id));
    expect(pending).toMatchObject({
      revision: 2,
      searchableText: `Updated title ${track.artistCredit
        .map(({ name, joinPhrase }) => `${name}${joinPhrase}`)
        .join('')}`,
      deliveredAt: expect.any(Date),
    });
    expect(replaceTrack).toHaveBeenNthCalledWith(
      1,
      track.id,
      expect.any(String),
    );
    expect(replaceTrack.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(replaceTrack).toHaveBeenNthCalledWith(
      2,
      track.id,
      `Updated title ${track.artistCredit
        .map(({ name, joinPhrase }) => `${name}${joinPhrase}`)
        .join('')}`,
    );
  });

  it('keeps a failed Sonic write pending with a durable retry time', async () => {
    const track = await createTrack(testApp.db);
    const processing = await createTrackProcessing(testApp.db, track.id, {
      status: 'EXTRACTING_LYRICS',
    });
    await completeProcessingThroughPipeline(processing.id);
    replaceTrack.mockRejectedValueOnce(new Error('Sonic unavailable'));

    const delivery = testApp.app.get(TrackSearchIndexService);
    const attemptAt = new Date(Date.now() + 1_000);
    await delivery.dispatchPending(attemptAt);

    const [pending] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, track.id));
    expect(pending).toMatchObject({ deliveredAt: null, attempts: 1 });
    expect(pending?.nextAttemptAt).toEqual(
      new Date(attemptAt.getTime() + 5_000),
    );

    replaceTrack.mockResolvedValue(undefined);
    await delivery.dispatchPending(pending?.nextAttemptAt ?? attemptAt);
    const [delivered] = await testApp.db
      .select()
      .from(trackSearchIndexEvents)
      .where(eq(trackSearchIndexEvents.trackId, track.id));
    expect(delivered?.deliveredAt).toBeInstanceOf(Date);
  });

  async function completeProcessingThroughPipeline(
    processingId: string,
  ): Promise<void> {
    await testApp.app
      .get(TrackPipelineService)
      .runStep({ processingId, step: 'EXTRACTING_LYRICS' }, true);
  }
});

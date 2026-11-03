import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import { tracks } from '../src/database/schema/tracks.js';
import { MusicCatalogClient } from '../src/integrations/music-catalog/music-catalog.client.js';
import { WebRevalidationService } from '../src/integrations/web-revalidation/web-revalidation.service.js';
import { TrackCoverService } from '../src/modules/tracks/track-cover.service.js';
import { TrackCoverRepairRepository } from '../src/modules/tracks/track-cover-repair.repository.js';
import { TrackCoverRepairService } from '../src/modules/tracks/track-cover-repair.service.js';
import { runTrackJobs } from './utils/track-pipeline.js';
import {
  coverImage,
  PRIMARY_RELEASE,
  requestTrack,
  resetTrackProcessingApp,
  startTrackProcessingApp,
  type TrackProcessingApp,
  trackRowOf,
} from './utils/track-processing-harness.js';

describe('repairing legacy Track covers (e2e)', () => {
  let app: TrackProcessingApp;
  let repair: TrackCoverRepairService;

  beforeAll(async () => {
    app = await startTrackProcessingApp();
    const nest = app.testApp.app;
    repair = new TrackCoverRepairService(
      new TrackCoverRepairRepository(nest.get(TransactionHost)),
      nest.get(MusicCatalogClient),
      nest.get(TrackCoverService),
      nest.get(WebRevalidationService),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTrackProcessingApp(app);
  });

  const legacyTrack = async () => {
    app.coverArt.releaseCovers.set(PRIMARY_RELEASE, await coverImage());
    const id = await requestTrack(app);
    await runTrackJobs(app.testApp);
    await app.testApp.db
      .update(tracks)
      .set({ primaryReleaseMbid: null })
      .where(eq(tracks.id, id));
    return id;
  };

  it('recovers the release, switches URLs and keeps the previous stored image', async () => {
    const id = await legacyTrack();
    const previous = await trackRowOf(app.testApp, id);

    await repair.repair();

    const repaired = await trackRowOf(app.testApp, id);
    expect(repaired.primaryReleaseMbid).toBe(PRIMARY_RELEASE);
    expect(repaired.coverUrl).not.toBe(previous.coverUrl);
    expect(repaired.coverUrl).toContain(`/${id}/${PRIMARY_RELEASE}.webp`);
    expect((await fetch(repaired.coverUrl ?? '')).status).toBe(200);
    expect((await fetch(previous.coverUrl ?? '')).status).toBe(200);
    const downloads = app.coverArt.releaseRequests.length;

    await repair.repair();

    expect(app.coverArt.releaseRequests).toHaveLength(downloads);
    expect((await trackRowOf(app.testApp, id)).coverUrl).toBe(
      repaired.coverUrl,
    );
  });

  it('leaves the persisted identity and cover untouched after a download failure', async () => {
    const id = await legacyTrack();
    const previous = await trackRowOf(app.testApp, id);
    app.coverArt.releaseFailure = new Error('archive unavailable');

    await expect(repair.repair()).rejects.toThrow('Cover repair failed');

    expect(await trackRowOf(app.testApp, id)).toMatchObject({
      coverUrl: previous.coverUrl,
      primaryReleaseMbid: null,
    });
  });

  it('recovers the source of a pending Track before its cover becomes available', async () => {
    const id = await requestTrack(app);
    await app.testApp.db
      .update(tracks)
      .set({ primaryReleaseMbid: null })
      .where(eq(tracks.id, id));

    await repair.repair();

    expect(await trackRowOf(app.testApp, id)).toMatchObject({
      coverUrl: null,
      primaryReleaseMbid: PRIMARY_RELEASE,
    });
    app.coverArt.releaseCovers.set(PRIMARY_RELEASE, await coverImage());

    await runTrackJobs(app.testApp);

    expect((await trackRowOf(app.testApp, id)).coverUrl).not.toBeNull();
    expect(app.coverArt.releaseRequests).toEqual([
      PRIMARY_RELEASE,
      PRIMARY_RELEASE,
    ]);
    expect(app.coverArt.imageRequests).toEqual([]);
  });
});

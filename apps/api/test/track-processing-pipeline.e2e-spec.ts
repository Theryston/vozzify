import { eq } from 'drizzle-orm';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { StorageService } from '../src/integrations/storage/storage.service.js';
import { WEB_REVALIDATION_QUEUE } from '../src/integrations/web-revalidation/web-revalidation.job.js';
import { TrackJobRunnerService } from '../src/modules/tracks/track-job-runner.service.js';
import { TRACK_PROCESSING_QUEUE } from '../src/modules/tracks/track-processing.job.js';
import type { TestApp } from './utils/create-test-app.js';
import { testMbid } from './utils/factories.js';
import type { FakeCoverArt } from './utils/fake-cover-art.js';
import type { FakeYouTubeMusic } from './utils/fake-youtube-music.js';
import { youtubeVideo } from './utils/fake-youtube-music.js';
import {
  queuedTrackJobs,
  runNextTrackJob,
  runTrackJobs,
} from './utils/track-pipeline.js';
import {
  bohemian,
  coverImage,
  LINKED_VIDEO,
  linkTo,
  PRIMARY_RELEASE,
  processingOf,
  processingRowOf,
  requestTrack,
  resetTrackProcessingApp,
  SEARCH_VIDEO,
  startTrackProcessingApp,
  type TrackProcessingApp,
  trackRowOf,
} from './utils/track-processing-harness.js';

// The Processing of a requested Track, end to end: the jobs run through the
// real job runner, the video and the cover are saved, and the Processing
// completes or fails with its code. Requests and guards are in
// track-processing-requests.e2e-spec.ts. YouTube and the Cover Art Archive are
// faked at their integration boundaries.

describe('Track Processing pipeline (e2e)', () => {
  let app: TrackProcessingApp;
  let testApp: TestApp;
  let youtube: FakeYouTubeMusic;
  let coverArt: FakeCoverArt;

  beforeAll(async () => {
    app = await startTrackProcessingApp();
    testApp = app.testApp;
    youtube = app.youtube;
    coverArt = app.coverArt;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTrackProcessingApp(app);
  });

  describe('finding the video', () => {
    it('chooses the Recording’s own YouTube link without searching for artwork', async () => {
      app.recordings.set(
        testMbid(1),
        bohemian({ externalUrls: [linkTo(LINKED_VIDEO)] }),
      );
      youtube.videos.set(LINKED_VIDEO, youtubeVideo({ videoId: LINKED_VIDEO }));
      const trackId = await requestTrack(app);

      // The video step first, then the rest (the cover and the download), from
      // their own entries.
      await runNextTrackJob(testApp);
      await runTrackJobs(testApp);

      const state = await processingOf(testApp, trackId);
      expect(state.processing).toMatchObject({
        status: 'COMPLETED',
        video: { id: LINKED_VIDEO, source: 'musicbrainz' },
      });
      expect((await trackRowOf(testApp, trackId)).youtubeVideoId).toBe(
        LINKED_VIDEO,
      );
      expect(youtube.lookups).toEqual([LINKED_VIDEO]);
      expect(youtube.searches).toEqual([]);
    });

    it('falls back to the best YouTube Music match when the link does not match', async () => {
      app.recordings.set(
        testMbid(1),
        bohemian({ externalUrls: [linkTo(LINKED_VIDEO)] }),
      );
      youtube.videos.set(
        LINKED_VIDEO,
        youtubeVideo({ videoId: LINKED_VIDEO, artists: ['Adele'] }),
      );
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      const state = await processingOf(testApp, trackId);
      expect(state.processing).toMatchObject({
        status: 'COMPLETED',
        video: { id: SEARCH_VIDEO, source: 'youtube_music' },
      });
      expect(youtube.lookups).toEqual([LINKED_VIDEO]);
      // Cover fallback uses the saved video and needs no additional search.
      expect(youtube.searches).toEqual(['Queen Bohemian Rhapsody']);
    });

    it('fails with VIDEO_NOT_FOUND when no candidate matches, and that failure is final', async () => {
      youtube.results = [youtubeVideo({ artists: ['Adele'], title: 'Hello' })];
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      const state = await processingOf(testApp, trackId);
      expect(state.processing).toMatchObject({
        status: 'FAILED',
        failureCode: 'VIDEO_NOT_FOUND',
        retryable: false,
        resumeFrom: 'FINDING_VIDEO',
        video: null,
      });
      expect((await trackRowOf(testApp, trackId)).youtubeVideoId).toBeNull();
      expect(queuedTrackJobs(testApp)).toEqual([]);
    });

    it('refuses a Recording over the limit before any search', async () => {
      app.recordings.set(testMbid(1), bohemian({ lengthMs: 1_000_000 }));
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect((await processingOf(testApp, trackId)).processing).toMatchObject({
        status: 'FAILED',
        failureCode: 'TOO_LONG',
        retryable: false,
      });
      expect(youtube.searches).toEqual([]);
      expect(youtube.lookups).toEqual([]);
    });

    it('refuses a chosen video over the limit when the Recording has no length', async () => {
      app.recordings.set(testMbid(1), bohemian({ lengthMs: null }));
      youtube.results = [youtubeVideo({ durationSeconds: 1_200 })];
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect((await processingOf(testApp, trackId)).processing).toMatchObject({
        status: 'FAILED',
        failureCode: 'TOO_LONG',
      });
    });

    it('fails with INTERNAL, retryable, when YouTube keeps failing on the last attempt', async () => {
      youtube.searchFailure = new Error('YouTube is down');
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect((await processingOf(testApp, trackId)).processing).toMatchObject({
        status: 'FAILED',
        failureCode: 'INTERNAL',
        retryable: true,
        resumeFrom: 'FINDING_VIDEO',
      });
    });

    it('leaves the Processing running while BullMQ still has attempts left', async () => {
      youtube.searchFailure = new Error('YouTube is down');
      const trackId = await requestTrack(app);
      const job = queuedTrackJobs(testApp)[0];
      testApp.queues[TRACK_PROCESSING_QUEUE]?.added.shift();

      await expect(
        testApp.app
          .get(TrackJobRunnerService)
          .run(job?.name ?? '', job?.data, false),
      ).rejects.toThrow('YouTube is down');

      expect((await processingOf(testApp, trackId)).processing).toMatchObject({
        status: 'FINDING_VIDEO',
        failureCode: null,
      });
    });
  });

  describe('the cover', () => {
    it('keeps the catalog release when a later same-year compilation sorts first by title', async () => {
      const recording = bohemian();
      app.recordings.set(
        testMbid(1),
        bohemian({
          releases: recording.releases.map((release, index) => ({
            ...release,
            title: index === 0 ? 'Shape of You' : 'Bravo: The Hits 2017',
            date: index === 0 ? '2017-01-06' : '2017-11-10',
          })),
        }),
      );
      coverArt.releaseCovers.set(PRIMARY_RELEASE, await coverImage());
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect((await trackRowOf(testApp, trackId)).primaryReleaseMbid).toBe(
        PRIMARY_RELEASE,
      );
      expect(coverArt.releaseRequests).toEqual([PRIMARY_RELEASE]);
      expect((await trackRowOf(testApp, trackId)).coverUrl).not.toBeNull();
    });

    it('uses the linked video thumbnail instead of an unrelated search artwork', async () => {
      app.recordings.set(
        testMbid(1),
        bohemian({ externalUrls: [linkTo(LINKED_VIDEO)] }),
      );
      youtube.videos.set(LINKED_VIDEO, youtubeVideo({ videoId: LINKED_VIDEO }));
      const thumbnail = `https://i.ytimg.com/vi/${LINKED_VIDEO}/hqdefault.jpg`;
      coverArt.images.set(thumbnail, await coverImage());
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect(coverArt.imageRequests).toEqual([thumbnail]);
      expect(youtube.searches).toEqual([]);
      expect((await trackRowOf(testApp, trackId)).coverUrl).not.toBeNull();
    });

    it('stores the front cover of the primary release in our storage and saves its URL', async () => {
      coverArt.releaseCovers.set(PRIMARY_RELEASE, await coverImage());
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect(coverArt.releaseRequests).toEqual([PRIMARY_RELEASE]);
      const { coverUrl } = await trackRowOf(testApp, trackId);
      const storage = testApp.app.get(StorageService);
      expect(coverUrl).toBe(storage.publicUrl(`track-covers/${trackId}.webp`));
      const stored = await fetch(coverUrl ?? '');
      expect(stored.status).toBe(200);
      expect(stored.headers.get('content-type')).toBe('image/webp');
      expect((await processingOf(testApp, trackId)).track.coverUrl).toBe(
        coverUrl,
      );
    });

    it('falls back to the chosen video thumbnail when the archive has no cover', async () => {
      const artwork = `https://i.ytimg.com/vi/${SEARCH_VIDEO}/hqdefault.jpg`;
      youtube.results = [
        youtubeVideo({ artworkUrl: 'https://img.test/other.jpg' }),
      ];
      coverArt.images.set(artwork, await coverImage());
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect(coverArt.imageRequests).toEqual([artwork]);
      expect((await trackRowOf(testApp, trackId)).coverUrl).not.toBeNull();
      // Only choosing the video needs a search.
      expect(youtube.searches).toHaveLength(1);
    });

    it('keeps the placeholder when neither source has an image', async () => {
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect((await trackRowOf(testApp, trackId)).coverUrl).toBeNull();
      expect((await processingOf(testApp, trackId)).processing?.status).toBe(
        'COMPLETED',
      );
    });

    it('does not hold the Processing back when the cover download fails', async () => {
      coverArt.releaseFailure = new Error(
        'Image download failed with HTTP 503',
      );
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      expect((await processingOf(testApp, trackId)).processing?.status).toBe(
        'COMPLETED',
      );
      expect((await trackRowOf(testApp, trackId)).coverUrl).toBeNull();
    });
  });

  describe('completing the Processing', () => {
    it('completes it, revalidates the Track pages and keeps the chosen video', async () => {
      const trackId = await requestTrack(app);

      await runTrackJobs(testApp);

      const state = await processingOf(testApp, trackId);
      expect(state.processing).toMatchObject({
        status: 'COMPLETED',
        failureCode: null,
        retryable: false,
        video: { id: SEARCH_VIDEO, source: 'youtube_music' },
      });
      expect(state.processing?.finishedAt).not.toBeNull();
      expect(testApp.queues[WEB_REVALIDATION_QUEUE]?.added).toContainEqual({
        name: 'revalidate',
        data: { tags: [`track:${trackId}`, 'tracks'] },
      });
    });
  });

  describe('running a job again', () => {
    it('changes nothing when a finished Processing gets its step job again', async () => {
      const trackId = await requestTrack(app);
      await runTrackJobs(testApp);
      const processing = await processingRowOf(testApp, trackId);
      const searches = youtube.searches.length;

      await testApp.app
        .get(TrackJobRunnerService)
        .run(
          'run-step',
          { processingId: processing.id, step: 'FINDING_VIDEO' },
          true,
        );

      expect(youtube.searches).toHaveLength(searches);
      expect(queuedTrackJobs(testApp)).toEqual([]);
      expect(await processingRowOf(testApp, trackId)).toMatchObject({
        status: 'COMPLETED',
        videoId: SEARCH_VIDEO,
      });
    });

    it('keeps the video an earlier run already chose when the step runs again', async () => {
      const trackId = await requestTrack(app);
      const processing = await processingRowOf(testApp, trackId);
      // What a crash after the video was saved, but before the Processing
      // completed, leaves behind: the step is still running, the video is kept.
      await testApp.db
        .update(trackProcessings)
        .set({
          status: 'FINDING_VIDEO',
          videoId: LINKED_VIDEO,
          videoSource: 'musicbrainz',
        })
        .where(eq(trackProcessings.id, processing.id));
      youtube.results = [];

      await testApp.app
        .get(TrackJobRunnerService)
        .run(
          'run-step',
          { processingId: processing.id, step: 'FINDING_VIDEO' },
          true,
        );

      expect(youtube.searches).toEqual([]);
      // The steps after the video run from the queue; the video is still kept.
      await runTrackJobs(testApp);
      expect(await processingRowOf(testApp, trackId)).toMatchObject({
        status: 'COMPLETED',
        videoId: LINKED_VIDEO,
        videoSource: 'musicbrainz',
      });
    });

    it('downloads nothing when the cover job runs for a Track that has one', async () => {
      coverArt.releaseCovers.set(PRIMARY_RELEASE, await coverImage());
      const trackId = await requestTrack(app);
      await runTrackJobs(testApp);
      const processing = await processingRowOf(testApp, trackId);
      const releaseRequests = coverArt.releaseRequests.length;
      const searches = youtube.searches.length;

      await testApp.app
        .get(TrackJobRunnerService)
        .run(
          'store-cover',
          { trackId, processingId: processing.id, artworkUrl: null },
          true,
        );

      expect(coverArt.releaseRequests).toHaveLength(releaseRequests);
      expect(youtube.searches).toHaveLength(searches);
    });
  });
});

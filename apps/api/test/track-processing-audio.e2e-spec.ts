import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { StorageService } from '../src/integrations/storage/storage.service.js';
import { TrackJobRunnerService } from '../src/modules/tracks/track-job-runner.service.js';
import type { TestApp } from './utils/create-test-app.js';
import { testMbid } from './utils/factories.js';
import { youtubeVideo } from './utils/fake-youtube-music.js';
import {
  queuedTrackJobs,
  runNextTrackJob,
  runTrackJobs,
} from './utils/track-pipeline.js';
import {
  bohemian,
  LINKED_VIDEO,
  linkTo,
  processingOf,
  processingRowOf,
  requestTrack,
  resetTrackProcessingApp,
  SEARCH_VIDEO,
  startTrackProcessingApp,
  type TrackProcessingApp,
} from './utils/track-processing-harness.js';

// The YouTube stream is faked at its integration boundary. FFmpeg converts
// the temporary audio for real and the WAV is streamed to MinIO.

describe('Track Processing download (e2e)', () => {
  let app: TrackProcessingApp;
  let testApp: TestApp;

  beforeAll(async () => {
    app = await startTrackProcessingApp();
    testApp = app.testApp;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTrackProcessingApp(app);
  });

  /** A Recording whose own link matches, so the chosen video is known. */
  const linkedRecording = () => {
    app.recordings.set(
      testMbid(1),
      bohemian({ externalUrls: [linkTo(LINKED_VIDEO)] }),
    );
    app.youtube.videos.set(
      LINKED_VIDEO,
      youtubeVideo({ videoId: LINKED_VIDEO }),
    );
  };

  it('converts the chosen video to WAV, stores it publicly and completes', async () => {
    linkedRecording();
    const trackId = await requestTrack(app);

    await runTrackJobs(testApp);

    expect(app.audio.requests).toEqual([LINKED_VIDEO]);
    expect(app.audio.downloads).toHaveLength(1);
    expect((await processingOf(testApp, trackId)).processing).toMatchObject({
      status: 'COMPLETED',
      failureCode: null,
    });

    // One object per Processing, so a later Processing never overwrites it.
    const processing = await processingRowOf(testApp, trackId);
    const storedUrl = testApp.app
      .get(StorageService)
      .publicUrl(`track-audio/${trackId}/${processing.id}.wav`);
    expect(processing.musicWavUrl).toBe(storedUrl);
    const stored = await fetch(storedUrl);
    expect(stored.status).toBe(200);
    expect(stored.headers.get('content-type')).toBe('audio/wav');
    const header = Buffer.from(await stored.arrayBuffer()).subarray(0, 12);
    expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(header.subarray(8, 12).toString('ascii')).toBe('WAVE');
  });

  it('finishes the download in one job and queues note detection without conversion polling', async () => {
    linkedRecording();
    const trackId = await requestTrack(app);
    await runNextTrackJob(testApp);
    await runNextTrackJob(testApp);
    await runNextTrackJob(testApp);

    const processing = await processingRowOf(testApp, trackId);
    expect(processing).toMatchObject({ status: 'DOWNLOADING_AUDIO' });
    expect(processing.musicWavUrl).not.toBeNull();
    expect(queuedTrackJobs(testApp)).toEqual([
      {
        name: 'run-step',
        data: { processingId: processing.id, step: 'EXTRACTING_VOCALS' },
      },
    ]);
    for (const path of app.audio.downloads)
      expect(existsSync(dirname(path))).toBe(false);
  });

  it('fails with DOWNLOAD_FAILED, retryable, when YouTube refuses the download', async () => {
    app.audio.requestFailure = new Error('YouTube answered HTTP 403');
    const trackId = await requestTrack(app);

    await runTrackJobs(testApp);

    expect((await processingOf(testApp, trackId)).processing).toMatchObject({
      status: 'FAILED',
      failureCode: 'DOWNLOAD_FAILED',
      retryable: true,
      resumeFrom: 'DOWNLOADING_AUDIO',
      video: { id: SEARCH_VIDEO, source: 'youtube_music' },
    });
    expect(app.audio.downloads).toEqual([]);
    expect((await processingRowOf(testApp, trackId)).musicWavUrl).toBeNull();
  });

  it('resumes a queued legacy conversion wait with the direct download', async () => {
    linkedRecording();
    const trackId = await requestTrack(app);
    await runNextTrackJob(testApp);
    await runNextTrackJob(testApp);
    const processing = await processingRowOf(testApp, trackId);
    await testApp.app.get(TrackJobRunnerService).run(
      'run-step',
      {
        processingId: processing.id,
        step: 'DOWNLOADING_AUDIO',
        wait: {
          round: 180,
          state: { progressUrl: 'https://old.test/progress' },
        },
      },
      true,
    );
    await runTrackJobs(testApp);

    expect((await processingOf(testApp, trackId)).processing).toMatchObject({
      status: 'COMPLETED',
      failureCode: null,
    });
    expect(app.audio.requests).toEqual([LINKED_VIDEO]);
    expect(app.audio.downloads).toHaveLength(1);
  });

  it('fails with DOWNLOAD_FAILED when the download is not audio ffmpeg can convert', async () => {
    app.audio.mp3 = new TextEncoder().encode('this is not an MP3 file');
    const trackId = await requestTrack(app);

    await runTrackJobs(testApp);

    expect((await processingOf(testApp, trackId)).processing).toMatchObject({
      status: 'FAILED',
      failureCode: 'DOWNLOAD_FAILED',
      resumeFrom: 'DOWNLOADING_AUDIO',
    });
    expect((await processingRowOf(testApp, trackId)).musicWavUrl).toBeNull();
  });

  it('saves the URL of a WAV an earlier run stored, without a download', async () => {
    linkedRecording();
    const trackId = await requestTrack(app);
    const processing = await processingRowOf(testApp, trackId);
    // What a crash after the WAV was uploaded, but before its URL was saved,
    // leaves behind: the step is running, the video is chosen, the object exists.
    await testApp.db
      .update(trackProcessings)
      .set({
        status: 'DOWNLOADING_AUDIO',
        videoId: LINKED_VIDEO,
        videoSource: 'musicbrainz',
      })
      .where(eq(trackProcessings.id, processing.id));
    const key = `track-audio/${trackId}/${processing.id}.wav`;
    const storage = testApp.app.get(StorageService);
    await storage.putPublicObject({
      key,
      body: new Uint8Array([82, 73, 70, 70]),
      contentType: 'audio/wav',
    });

    await testApp.app
      .get(TrackJobRunnerService)
      .run(
        'run-step',
        { processingId: processing.id, step: 'DOWNLOADING_AUDIO' },
        true,
      );
    // The download is the step before the note detection: the rest of the
    // Processing runs the RunPod job the fake answers as done.
    await runTrackJobs(testApp);

    expect(app.audio.requests).toEqual([]);
    expect(app.audio.downloads).toEqual([]);
    expect(await processingRowOf(testApp, trackId)).toMatchObject({
      status: 'COMPLETED',
      musicWavUrl: storage.publicUrl(key),
    });
  });

  it('downloads nothing again once its WAV is stored, when the step runs again', async () => {
    linkedRecording();
    const trackId = await requestTrack(app);
    await runTrackJobs(testApp);
    const processing = await processingRowOf(testApp, trackId);
    const storedUrl = processing.musicWavUrl;
    const requests = app.audio.requests.length;
    const downloads = app.audio.downloads.length;
    // What a crash after the WAV was stored, but before the Processing
    // completed, leaves behind: the step is still running, with its WAV.
    await testApp.db
      .update(trackProcessings)
      .set({ status: 'DOWNLOADING_AUDIO', finishedAt: null })
      .where(eq(trackProcessings.id, processing.id));

    await testApp.app
      .get(TrackJobRunnerService)
      .run(
        'run-step',
        { processingId: processing.id, step: 'DOWNLOADING_AUDIO' },
        true,
      );
    // The note detection runs after the download; its RunPod job is already
    // saved, so the vocals stage polls it instead of starting another.
    await runTrackJobs(testApp);

    expect(app.audio.requests).toHaveLength(requests);
    expect(app.audio.downloads).toHaveLength(downloads);
    expect(await processingRowOf(testApp, trackId)).toMatchObject({
      status: 'COMPLETED',
      musicWavUrl: storedUrl,
    });
  });
});

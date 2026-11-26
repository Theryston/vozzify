import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  privateTrackDetailSchema,
  privateTrackSchema,
} from '@vozzify/contracts';
import { ElevenLabsTranscriptionClient } from '../src/integrations/elevenlabs/elevenlabs-transcription.client.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../src/integrations/note-detection/note-detection.client.js';
import { YouTubeMusicClient } from '../src/integrations/youtube-music/youtube-music.client.js';
import { SubscriptionMembershipService } from '../src/modules/plans/subscription-membership.service.js';
import {
  PRIVATE_TRACK_PROCESSING_QUEUE,
  PROCESS_PRIVATE_TRACK_JOB,
} from '../src/modules/private-tracks/private-track-processing.job.js';
import { PrivateTrackProcessingService } from '../src/modules/private-tracks/private-track-processing.service.js';
import { billingUser } from './utils/billing-fixture.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import { youtubeVideo } from './utils/fake-youtube-music.js';

const ROOT = '/v1/me/private-tracks';
const VIDEO_ID = 'aBcd1Efgh_2';
const audioFile = fileURLToPath(
  new URL('../../web/e2e/fixtures/a4-440hz.wav', import.meta.url),
);

describe('private track timed lyrics', () => {
  let app: TestApp;
  const startJob = vi.fn<(input: NoteDetectionInput) => Promise<string>>();
  const checkJob = vi.fn();
  const transcribe = vi.fn();
  const hasPaidMembership = vi.fn();

  beforeAll(async () => {
    app = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(SubscriptionMembershipService)
          .useValue({ hasPaidMembership })
          .overrideProvider(NoteDetectionClient)
          .useValue({ startJob, checkJob })
          .overrideProvider(ElevenLabsTranscriptionClient)
          .useValue({ transcribe })
          .overrideProvider(YouTubeMusicClient)
          .useValue({
            getPracticeVideo: async () =>
              youtubeVideo({ videoId: VIDEO_ID, durationSeconds: 2 }),
            downloadAudio: async () =>
              new Response(await readFile(audioFile)).body,
          }),
    });
  });
  afterAll(async () => app?.close());
  beforeEach(async () => {
    vi.resetAllMocks();
    hasPaidMembership.mockResolvedValue(true);
    startJob.mockResolvedValue('detector-id');
    await resetDatabase(app.db);
  });

  function latestJob() {
    const job = app.queues[PRIVATE_TRACK_PROCESSING_QUEUE]?.added.findLast(
      ({ name }) => name === PROCESS_PRIVATE_TRACK_JOB,
    );
    if (!job) throw new Error('Expected a queued private track');
    return job.data;
  }

  it.each(['upload', 'youtube'])(
    'transcribes the separated vocals for a %s submission and resumes lyrics after a failure',
    async (source) => {
      const { client } = await billingUser(app);
      const response =
        source === 'upload'
          ? await client.post(ROOT).attach('audio', audioFile).expect(201)
          : await client
              .post(`${ROOT}/youtube`)
              .send({ url: `https://youtu.be/${VIDEO_ID}` })
              .expect(201);
      const path = `${ROOT}/${privateTrackSchema.parse(response.body).id}`;
      const processing = app.app.get(PrivateTrackProcessingService);
      await processing.process(latestJob());
      const input = startJob.mock.calls[0]?.[0];
      if (!input) throw new Error('Missing detector input');
      const vocals = await readFile(audioFile);
      const upload = await fetch(input.vocalsUpload.presignedPutUrl, {
        method: 'PUT',
        headers: { 'content-type': 'audio/wav' },
        body: vocals,
      });
      expect(upload.ok).toBe(true);
      const notes = [{ pitch: 69, start: 0, end: 1 }];
      checkJob.mockResolvedValue({
        kind: 'completed',
        output: {
          vocalsUrl: input.vocalsUpload.publicUrl,
          pitchCurveUrl: input.pitchCurveUpload.publicUrl,
          detectorVersion: 'test',
          notes,
        },
      });
      const poll = latestJob();
      transcribe.mockRejectedValueOnce(new Error('Scribe unavailable'));
      await expect(processing.process(poll, false)).rejects.toThrow(
        'Scribe unavailable',
      );
      expect((await client.get(path).expect(200)).body.processing.status).toBe(
        'EXTRACTING_LYRICS',
      );
      transcribe.mockImplementationOnce(
        async ({ sourceUrl }: { sourceUrl: string }) => {
          expect(new URL(sourceUrl).pathname).toBe(
            new URL(input.vocalsUpload.presignedPutUrl).pathname,
          );
          expect(
            Buffer.from(await (await fetch(sourceUrl)).arrayBuffer()),
          ).toEqual(vocals);
          return {
            segments: [],
            words: [{ word: 'Sing', start: 0.1, end: 0.8 }],
          };
        },
      );
      await processing.process(poll, false);
      await processing.process(poll);
      const detail = privateTrackDetailSchema.parse(
        (await client.get(path).expect(200)).body,
      );
      expect(detail).toMatchObject({
        processing: { status: 'COMPLETED', progress: 100 },
        notes,
        lyrics: {
          lines: [
            {
              start: 0.1,
              end: 0.8,
              words: [{ text: 'Sing', start: 0.1, end: 0.8 }],
            },
          ],
        },
      });
      expect(checkJob).toHaveBeenCalledOnce();
      expect(transcribe).toHaveBeenCalledTimes(2);
      hasPaidMembership.mockResolvedValue(false);
      expect((await client.get(path).expect(200)).body).not.toHaveProperty(
        'lyrics',
      );
    },
  );
});

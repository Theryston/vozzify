import {
  createTrackResultSchema,
  type Locale,
  type Recording,
  trackProcessingStateSchema,
} from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request, { type Response } from 'supertest';
import { trackProcessings } from '../../src/database/schema/track-processings.js';
import { tracks } from '../../src/database/schema/tracks.js';
import { AudioDownloadClient } from '../../src/integrations/audio-download/audio-download.client.js';
import { CoverArtClient } from '../../src/integrations/cover-art/cover-art.client.js';
import { ElevenLabsTranscriptionClient } from '../../src/integrations/elevenlabs/elevenlabs-transcription.client.js';
import { NoteDetectionClient } from '../../src/integrations/note-detection/note-detection.client.js';
import { WEB_REVALIDATION_QUEUE } from '../../src/integrations/web-revalidation/web-revalidation.job.js';
import { YouTubeMusicClient } from '../../src/integrations/youtube-music/youtube-music.client.js';
import { TRACK_PROCESSING_QUEUE } from '../../src/modules/tracks/track-processing.job.js';
import { type AuthClient, createAuthClient, signIn } from './auth.js';
import {
  type CreateTestAppOptions,
  createTestApp,
  type TestApp,
} from './create-test-app.js';
import { resetDatabase } from './database.js';
import {
  createPasswordUser,
  DEFAULT_PASSWORD,
  testMbid,
  type User,
} from './factories.js';
import { FakeAudioDownload } from './fake-audio-download.js';
import { FakeCoverArt } from './fake-cover-art.js';
import {
  FAKE_CATALOG_API_KEY,
  type FakeMusicCatalog,
  startFakeMusicCatalog,
} from './fake-music-catalog.js';
import { FakeNoteDetection } from './fake-note-detection.js';
import { FakeTranscription } from './fake-transcription.js';
import { FakeYouTubeMusic } from './fake-youtube-music.js';
import { recordingFixture } from './recording-fixtures.js';

// What the Processing e2e specs share: the fixtures of a Recording on two
// releases, the app with its fakes (the Music catalog, YouTube and the Cover
// Art Archive), and the requests and reads they make.

export const PRIMARY_RELEASE = testMbid(31); // 1975: the first release of the list
const LATER_RELEASE = testMbid(32); // 1990
export const LINKED_VIDEO = 'aaaaaaaaaaa';
export const SEARCH_VIDEO = 'bbbbbbbbbbb';

const release = (mbid: string, date: string) => ({
  mbid,
  title: 'A Night at the Opera',
  releaseGroup: { mbid: testMbid(40), primaryType: 'Album' },
  status: 'Official',
  date,
  country: 'GB',
  mediumPosition: 1,
  trackPosition: 11,
  coverArtUrl: `https://coverartarchive.org/release/${mbid}/front-500`,
});

const QUEEN = {
  name: 'Queen',
  artists: [
    {
      mbid: testMbid(41),
      name: 'Queen',
      creditedName: 'Queen',
      joinPhrase: '',
    },
  ],
};

/** "Bohemian Rhapsody" by Queen, 5:54, on two releases. */
export const bohemian = (overrides: Partial<Recording> = {}): Recording =>
  recordingFixture({
    artistCredit: QUEEN,
    releases: [
      release(PRIMARY_RELEASE, '1975-10-31'),
      release(LATER_RELEASE, '1990-06-01'),
    ],
    ...overrides,
  });

/** A MusicBrainz link to a YouTube video. */
export const linkTo = (videoId: string) => ({
  url: `https://music.youtube.com/watch?v=${videoId}`,
  linkType: 'streaming music',
});

/** A PNG the cover job can decode and store. */
export const coverImage = async () => ({
  bytes: new Uint8Array(
    await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 30, g: 60, b: 90 },
      },
    })
      .png()
      .toBuffer(),
  ),
  contentType: 'image/png',
});

export type TrackProcessingApp = {
  testApp: TestApp;
  catalog: FakeMusicCatalog;
  /** The Recordings the catalog knows, by MBID. */
  recordings: Map<string, Recording>;
  youtube: FakeYouTubeMusic;
  coverArt: FakeCoverArt;
  /** YouTube audio download; ffmpeg and S3 run for real. */
  audio: FakeAudioDownload;
  /** RunPod's note detection; each spec sets the answers of its job. */
  noteDetection: FakeNoteDetection;
  /** Scribe's transcription of the Timed lyrics; each spec sets its answers. */
  transcription: FakeTranscription;
  close: () => Promise<void>;
};

/** The app, with the Music catalog and the fakes of YouTube and the archive. */
export const startTrackProcessingApp =
  async (): Promise<TrackProcessingApp> => {
    const recordings = new Map<string, Recording>();
    const youtube = new FakeYouTubeMusic();
    const coverArt = new FakeCoverArt();
    const audio = new FakeAudioDownload();
    const noteDetection = new FakeNoteDetection();
    const transcription = new FakeTranscription();
    const catalog = await startFakeMusicCatalog((payload) => {
      const recording = recordings.get(String(payload.mbid));
      if (recording === undefined) {
        return {
          error: { code: 'RECORDING_NOT_FOUND', message: 'No such Recording' },
        };
      }
      return { result: recording };
    });
    const options: Pick<CreateTestAppOptions, 'env' | 'override'> = {
      env: {
        MUSIC_CATALOG_URL: catalog.url,
        MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
        MUSIC_CATALOG_REQUEST_TIMEOUT_MS: 1_000,
      },
      override: (builder) =>
        builder
          .overrideProvider(YouTubeMusicClient)
          .useValue(youtube)
          .overrideProvider(CoverArtClient)
          .useValue(coverArt)
          .overrideProvider(AudioDownloadClient)
          .useValue(audio)
          .overrideProvider(NoteDetectionClient)
          .useValue(noteDetection)
          .overrideProvider(ElevenLabsTranscriptionClient)
          .useValue(transcription),
    };
    const testApp = await createTestApp(options);
    return {
      testApp,
      catalog,
      recordings,
      youtube,
      coverArt,
      audio,
      noteDetection,
      transcription,
      close: async () => {
        await testApp.close();
        await catalog.close();
      },
    };
  };

/** Empties the database and the fakes, and queues: each test starts fresh. */
export const resetTrackProcessingApp = async (
  app: TrackProcessingApp,
): Promise<void> => {
  await resetDatabase(app.testApp.db);
  app.recordings.clear();
  app.recordings.set(testMbid(1), bohemian());
  app.youtube.reset();
  app.coverArt.reset();
  app.audio.reset();
  app.noteDetection.reset();
  app.transcription.reset();
  app.testApp.queues[TRACK_PROCESSING_QUEUE]?.added.splice(0);
  app.testApp.queues[WEB_REVALIDATION_QUEUE]?.added.splice(0);
};

/** A client signed in as the User, to make requests with. */
export const signedInClient = async (
  testApp: TestApp,
  user: User,
): Promise<AuthClient> => {
  const client = createAuthClient(testApp);
  await signIn(client, {
    email: user.email,
    password: DEFAULT_PASSWORD,
  }).expect(200);
  return client;
};

/** A new signed-in User requests a Recording's Track; answers its ID (202). */
export const requestTrack = async (
  app: TrackProcessingApp,
  mbid = testMbid(1),
): Promise<string> => {
  const user = await createPasswordUser(app.testApp.db);
  const client = await signedInClient(app.testApp, user);
  const response = await client
    .post('/v1/tracks')
    .send({ recordingMbid: mbid, locale: 'en' })
    .expect(202);
  return createTrackResultSchema.parse(response.body).trackId;
};

/** What the Processing page reads (the public endpoint, no session). */
export const processingOf = async (testApp: TestApp, trackId: string) => {
  const response = await request(testApp.app.getHttpServer())
    .get(`/v1/tracks/${trackId}/processing`)
    .expect(200);
  return trackProcessingStateSchema.parse(response.body);
};

/** The Processing row of a Track, as the database holds it. */
export const processingRowOf = async (testApp: TestApp, trackId: string) => {
  const [row] = await testApp.db
    .select()
    .from(trackProcessings)
    .where(eq(trackProcessings.trackId, trackId));
  if (row === undefined) {
    throw new Error(`Track ${trackId} has no Processing`);
  }
  return row;
};

/** The Track row, as the database holds it. */
export const trackRowOf = async (testApp: TestApp, trackId: string) => {
  const [row] = await testApp.db
    .select()
    .from(tracks)
    .where(eq(tracks.id, trackId));
  if (row === undefined) {
    throw new Error(`Track ${trackId} is gone`);
  }
  return row;
};

/** A signed-in User asks for a Recording's Track in a locale; answers its ID (202). */
export const requestTrackAs = async (
  app: TrackProcessingApp,
  user: User,
  locale: Locale,
  mbid = testMbid(1),
): Promise<string> => {
  const client = await signedInClient(app.testApp, user);
  const response = await client
    .post('/v1/tracks')
    .send({ recordingMbid: mbid, locale })
    .expect(202);
  return createTrackResultSchema.parse(response.body).trackId;
};

/** A signed-in User asks to retry the Track's latest Processing, from `locale`. */
export const retryTrackAs = async (
  testApp: TestApp,
  user: User,
  trackId: string,
  locale: string,
): Promise<Response> => {
  const client = await signedInClient(testApp, user);
  return client.post(`/v1/tracks/${trackId}/processing/retry`).send({ locale });
};

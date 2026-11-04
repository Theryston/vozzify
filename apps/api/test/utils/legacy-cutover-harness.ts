import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Queue } from 'bullmq';
import { ENV } from '../../src/config/env.js';
import { AudioDownloadClient } from '../../src/integrations/audio-download/audio-download.client.js';
import { CoverArtClient } from '../../src/integrations/cover-art/cover-art.client.js';
import { ElevenLabsTranscriptionClient } from '../../src/integrations/elevenlabs/elevenlabs-transcription.client.js';
import { NoteDetectionClient } from '../../src/integrations/note-detection/note-detection.client.js';
import { YouTubeMusicClient } from '../../src/integrations/youtube-music/youtube-music.client.js';
import { TrackMetadataService } from '../../src/modules/track-metadata/track-metadata.service.js';
import { TrackJobRunnerService } from '../../src/modules/tracks/track-job-runner.service.js';
import { TRACK_PROCESSING_QUEUE } from '../../src/modules/tracks/track-processing.job.js';
import {
  importMetadataJobSchema,
  TRACK_METADATA_QUEUE,
} from '../../src/queue/track-metadata.job.js';
import { createTestApp } from './create-test-app.js';
import { FakeAudioDownload } from './fake-audio-download.js';
import { FakeCoverArt } from './fake-cover-art.js';
import { FAKE_CATALOG_API_KEY } from './fake-music-catalog.js';
import { FakeNoteDetection } from './fake-note-detection.js';
import { FakeTranscription } from './fake-transcription.js';
import { FakeYouTubeMusic } from './fake-youtube-music.js';

export const cutoverApp = async (catalogUrl: string) => {
  const audio = new FakeAudioDownload();
  const notes = new FakeNoteDetection();
  const youtube = new FakeYouTubeMusic();
  youtube.reset();
  const app = await createTestApp({
    env: {
      MUSIC_CATALOG_URL: catalogUrl,
      MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
    },
    override: (builder) => {
      for (const [provider, fake] of [
        [AudioDownloadClient, audio],
        [NoteDetectionClient, notes],
        [YouTubeMusicClient, youtube],
        [CoverArtClient, new FakeCoverArt()],
        [ElevenLabsTranscriptionClient, new FakeTranscription()],
      ] as const)
        builder.overrideProvider(provider).useValue(fake);
      return builder;
    },
  });
  return { app, audio, notes, youtube };
};

export const compiledCutover = (options: {
  app: Awaited<ReturnType<typeof cutoverApp>>['app'];
  sourceUrl: string;
  databaseUrl: string;
  redisPort: number;
  catalogUrl: string;
}) => {
  const env = options.app.app.get(ENV);
  return async (stage: string) => {
    const childEnv: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: options.databaseUrl,
      LEGACY_DATABASE_URL: options.sourceUrl,
      REDIS_URL: `redis://127.0.0.1:${options.redisPort}`,
      MUSIC_CATALOG_URL: options.catalogUrl,
      MUSIC_CATALOG_API_KEY: FAKE_CATALOG_API_KEY,
      LEGACY_PROCESSING_CONCURRENCY: '1',
    };
    for (const key of [
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_PUBLIC_URL',
      'S3_FORCE_PATH_STYLE',
    ] as const) {
      const value = env[key];
      if (value !== undefined) childEnv[key] = String(value);
    }
    return new Promise<{ code: number; report: unknown; output: string }>(
      (resolve, reject) => {
        execFile(
          process.execPath,
          ['dist/main.js', '--legacy-cutover', stage],
          { env: childEnv, maxBuffer: 5_000_000 },
          (error, stdout, stderr) => {
            const output = stdout + stderr;
            const json = output
              .split('\n')
              .find((line) => line.includes('{"cutover":true'));
            if (!json) {
              reject(new Error(`No cutover report: ${output}`));
              return;
            }
            resolve({
              code: error ? Number(error.code) : 0,
              report: JSON.parse(
                json.slice(
                  json.indexOf('{"cutover":true'),
                  json.lastIndexOf('}') + 1,
                ),
              ),
              output,
            });
          },
        );
      },
    );
  };
};

/** Consume persisted operator jobs through the real API job runners. */
export const consumeCutoverJobs = async (options: {
  app: Awaited<ReturnType<typeof cutoverApp>>['app'];
  redisPort: number;
  metadata?: boolean;
}) => {
  const name = options.metadata ? TRACK_METADATA_QUEUE : TRACK_PROCESSING_QUEUE;
  const queue = new Queue(name, {
    prefix: 'vozzify:bull',
    connection: { host: '127.0.0.1', port: options.redisPort },
  });
  try {
    for (const job of await queue.getJobs(['wait'])) {
      if (options.metadata) {
        await options.app.app
          .get(TrackMetadataService)
          .run(importMetadataJobSchema.parse(job.data), false);
      } else {
        await options.app.app
          .get(TrackJobRunnerService)
          .run(job.name, job.data, true);
      }
      await job.remove();
    }
  } finally {
    await queue.close();
  }
};

export const buildCutover = async () => {
  await promisify(execFile)(process.execPath, [
    'node_modules/@nestjs/cli/bin/nest.js',
    'build',
  ]);
};

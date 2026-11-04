import { Test } from '@nestjs/testing';
import { ENV, parseEnv } from '../src/config/env.js';
import { LegacyRecordingGroupModule } from '../src/modules/legacy-import/legacy-recording-group.module.js';
import { LegacyRecordingGroupService } from '../src/modules/legacy-import/legacy-recording-group.service.js';
import { TrackMetadataProcessor } from '../src/modules/track-metadata/track-metadata.processor.js';
import { TrackMp3Processor } from '../src/modules/tracks/track-mp3.processor.js';
import { TrackProcessingProcessor } from '../src/modules/tracks/track-processing.processor.js';
import { overrideRedisProviders } from './redis-test-overrides.js';

// The CLI must bootstrap independently of AppModule and must never consume
// another queued Processing while an operator is only preparing a group.
describe('LegacyRecordingGroupModule operator context', () => {
  it('boots the standalone context without Processing or metadata workers', async () => {
    const { builder } = overrideRedisProviders(
      Test.createTestingModule({ imports: [LegacyRecordingGroupModule] }),
    );
    const module = await builder
      .overrideProvider(ENV)
      .useValue(
        parseEnv({
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
          REDIS_URL: 'redis://127.0.0.1:1',
          MUSIC_CATALOG_URL: undefined,
          MUSIC_CATALOG_API_KEY: undefined,
          S3_REGION: 'us-east-1',
          S3_BUCKET: 'test',
          S3_ACCESS_KEY_ID: 'test',
          S3_SECRET_ACCESS_KEY: 'test',
          S3_PUBLIC_URL: 'http://127.0.0.1:1/test',
        }),
      )
      .compile();
    try {
      await module.init();
      expect(module.get(LegacyRecordingGroupService)).toBeInstanceOf(
        LegacyRecordingGroupService,
      );
      for (const worker of [
        TrackProcessingProcessor,
        TrackMp3Processor,
        TrackMetadataProcessor,
      ]) {
        expect(() => module.get(worker)).toThrow();
      }
    } finally {
      await module.close();
    }
  });
});

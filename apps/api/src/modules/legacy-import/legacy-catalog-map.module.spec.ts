import { getQueueToken } from '@nestjs/bullmq';
import { DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ENV } from '../../config/env.js';
import { TRACK_METADATA_QUEUE } from '../../queue/track-metadata.job.js';
import { LegacyCatalogMapModule } from './legacy-catalog-map.module.js';
import { LEGACY_IMPORT_ENV } from './legacy-source.repository.js';

describe('LegacyCatalogMapModule', () => {
  it('boots its operator context without Processing or MP3 workers', async () => {
    const module = await Test.createTestingModule({
      imports: [LegacyCatalogMapModule],
    })
      .overrideProvider(ENV)
      .useValue({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/test',
        REDIS_URL: 'redis://127.0.0.1:1',
      })
      .overrideProvider(getQueueToken(TRACK_METADATA_QUEUE))
      .useValue({
        getJob: async () => undefined,
        add: async () => ({ id: '' }),
      })
      .overrideProvider(LEGACY_IMPORT_ENV)
      .useValue({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/source',
        LEGACY_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/source',
      })
      .compile();
    try {
      const providers = module
        .get(DiscoveryService)
        .getProviders()
        .flatMap((wrapper) =>
          wrapper.metatype?.name ? [wrapper.metatype.name] : [],
        );
      expect(providers).not.toContain('TrackProcessingProcessor');
      expect(providers).not.toContain('TrackMp3Processor');
    } finally {
      await module.close();
    }
  });
});

import { Test } from '@nestjs/testing';
import { LegacyTrackMapRepository } from './legacy-track-map.repository.js';
import { LegacyTrackMapService } from './legacy-track-map.service.js';

describe('LegacyTrackMapService', () => {
  it('delegates resolution to the repository that reads prepared Track maps', async () => {
    const resolutions = new Map([
      ['legacy-a', { kind: 'mapped' as const, trackId: 'track-a' }],
      ['legacy-skip', { kind: 'skipped' as const }],
      ['legacy-pending', { kind: 'pending' as const }],
    ]);
    const maps = { resolve: vi.fn(async () => resolutions) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LegacyTrackMapService,
        { provide: LegacyTrackMapRepository, useValue: maps },
      ],
    }).compile();
    try {
      await expect(
        moduleRef
          .get(LegacyTrackMapService)
          .resolve(['legacy-a', 'legacy-skip', 'legacy-pending']),
      ).resolves.toBe(resolutions);
      expect(maps.resolve).toHaveBeenCalledWith([
        'legacy-a',
        'legacy-skip',
        'legacy-pending',
      ]);
    } finally {
      await moduleRef.close();
    }
  });
});

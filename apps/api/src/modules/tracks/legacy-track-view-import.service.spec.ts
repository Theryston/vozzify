import { Test } from '@nestjs/testing';
import type { LegacyView } from '../legacy-import/legacy-relationships.js';
import type { LegacyTrackResolution } from './legacy-track-map.repository.js';
import { LegacyTrackMapService } from './legacy-track-map.service.js';
import { LegacyTrackViewImportRepository } from './legacy-track-view-import.repository.js';
import { LegacyTrackViewImportService } from './legacy-track-view-import.service.js';
import { TrackTrendingService } from './track-trending.service.js';

const view = (id: string, trackId: string): LegacyView => ({
  id,
  trackId,
  userId: null,
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-02T00:00:00Z'),
});

const makeService = async () => {
  const resolutions = new Map<string, LegacyTrackResolution>([
    ['old-a', { kind: 'mapped', trackId: 'track-a' }],
    ['old-b', { kind: 'mapped', trackId: 'track-a' }],
    ['old-skip', { kind: 'skipped' }],
  ]);
  const maps = {
    resolve: vi.fn(async () => resolutions),
  };
  const views = {
    importPage: vi.fn(async () => ({ imported: 2, skipped: 1 })),
  };
  const trending = { refresh: vi.fn(async () => undefined) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      LegacyTrackViewImportService,
      { provide: LegacyTrackMapService, useValue: maps },
      { provide: LegacyTrackViewImportRepository, useValue: views },
      { provide: TrackTrendingService, useValue: trending },
    ],
  }).compile();
  return {
    service: moduleRef.get(LegacyTrackViewImportService),
    maps,
    views,
    trending,
    close: () => moduleRef.close(),
  };
};

describe('LegacyTrackViewImportService', () => {
  it('maps views, then refreshes each affected Track once per page', async () => {
    const importer = await makeService();
    const rows = [
      view('v1', 'old-a'),
      view('v2', 'old-b'),
      view('v3', 'old-skip'),
    ];
    try {
      await expect(importer.service.importPage(rows)).resolves.toEqual({
        imported: 2,
        skipped: 1,
      });
      expect(importer.views.importPage).toHaveBeenCalledWith(
        rows,
        new Map([
          ['old-a', 'track-a'],
          ['old-b', 'track-a'],
        ]),
      );
      await importer.service.refreshPage(rows);
      expect(importer.trending.refresh).toHaveBeenCalledOnce();
      expect(importer.trending.refresh).toHaveBeenCalledWith('track-a');
    } finally {
      await importer.close();
    }
  });

  it('leaves view writes untouched while a planned Track has no map', async () => {
    const importer = await makeService();
    importer.maps.resolve.mockResolvedValue(
      new Map([['old-a', { kind: 'pending' as const }]]),
    );
    try {
      await expect(
        importer.service.importPage([view('v1', 'old-a')]),
      ).rejects.toThrow('RELATIONSHIP_MAP_PENDING');
      expect(importer.views.importPage).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });

  it('rejects a row without a saved correspondence plan', async () => {
    const importer = await makeService();
    importer.maps.resolve.mockResolvedValue(new Map());
    try {
      await expect(
        importer.service.importPage([view('v1', 'missing')]),
      ).rejects.toThrow('RELATIONSHIP_PLAN_MISSING');
      expect(importer.views.importPage).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });
});

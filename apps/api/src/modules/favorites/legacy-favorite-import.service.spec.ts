import { Test } from '@nestjs/testing';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { PersonalHomeQueueService } from '../home/home-personal-queue.service.js';
import type { LegacyFavorite } from '../legacy-import/legacy-relationships.js';
import { LegacyTrackMapService } from '../tracks/legacy-track-map.service.js';
import { LegacyFavoriteImportRepository } from './legacy-favorite-import.repository.js';
import { LegacyFavoriteImportService } from './legacy-favorite-import.service.js';

const favorite: LegacyFavorite = {
  id: 'favorite-a',
  userId: 'user-a',
  trackId: 'legacy-track-a',
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-02T00:00:00Z'),
};

const makeService = async (
  resolution: { kind: string; trackId?: string },
  options: { username?: string | null; revalidationFails?: boolean } = {},
) => {
  const maps = {
    resolve: vi.fn(async () => new Map([[favorite.trackId, resolution]])),
  };
  const favorites = {
    importPage: vi.fn(async () => ({
      accepted: resolution.kind === 'mapped' ? 1 : 0,
      imported: resolution.kind === 'mapped' ? 1 : 0,
      deduplicated: 0,
      skipped: resolution.kind === 'skipped' ? 1 : 0,
    })),
    usernamesFor: vi.fn(async () =>
      options.username === null ? [] : [options.username ?? 'ada'],
    ),
  };
  const personalRefresh = { scheduleRefresh: vi.fn(async () => undefined) };
  const revalidation = {
    revalidate: vi.fn(async () => {
      if (options.revalidationFails) throw new Error('queue unavailable');
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      LegacyFavoriteImportService,
      { provide: LegacyTrackMapService, useValue: maps },
      { provide: LegacyFavoriteImportRepository, useValue: favorites },
      { provide: PersonalHomeQueueService, useValue: personalRefresh },
      { provide: WebRevalidationService, useValue: revalidation },
    ],
  }).compile();
  return {
    service: moduleRef.get(LegacyFavoriteImportService),
    favorites,
    personalRefresh,
    revalidation,
    close: () => moduleRef.close(),
  };
};

describe('LegacyFavoriteImportService', () => {
  it('persists mapped rows separately from refresh acceptance', async () => {
    const importer = await makeService({ kind: 'mapped', trackId: 'track-a' });
    try {
      await expect(
        importer.service.importPage([favorite]),
      ).resolves.toMatchObject({
        accepted: 1,
        imported: 1,
        deduplicated: 0,
      });
      expect(importer.favorites.importPage).toHaveBeenCalledWith(
        [favorite],
        new Map([[favorite.trackId, { kind: 'mapped', trackId: 'track-a' }]]),
      );
      expect(importer.personalRefresh.scheduleRefresh).not.toHaveBeenCalled();
      await importer.service.refreshPage([favorite]);
      expect(importer.personalRefresh.scheduleRefresh).toHaveBeenCalledTimes(2);
      expect(importer.revalidation.revalidate).toHaveBeenCalledWith([
        expect.stringMatching(/favorites/),
      ]);
    } finally {
      await importer.close();
    }
  });

  it('counts definitive skips without refreshing destination user data', async () => {
    const importer = await makeService({ kind: 'skipped' });
    try {
      await expect(
        importer.service.importPage([favorite]),
      ).resolves.toMatchObject({
        skipped: 1,
      });
      expect(importer.personalRefresh.scheduleRefresh).not.toHaveBeenCalled();
      expect(importer.revalidation.revalidate).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });

  it.each([{ kind: 'pending' }, { kind: 'unknown' }])(
    'does not write a $kind mapping',
    async (resolution) => {
      const importer = await makeService(resolution);
      try {
        await expect(importer.service.importPage([favorite])).rejects.toThrow(
          resolution.kind === 'pending'
            ? 'RELATIONSHIP_MAP_PENDING'
            : 'RELATIONSHIP_PLAN_MISSING',
        );
        expect(importer.favorites.importPage).not.toHaveBeenCalled();
      } finally {
        await importer.close();
      }
    },
  );

  it('propagates profile refresh failure so the caller can retry it', async () => {
    const importer = await makeService(
      { kind: 'mapped', trackId: 'track-a' },
      { revalidationFails: true },
    );
    try {
      await expect(
        importer.service.importPage([favorite]),
      ).resolves.toMatchObject({ imported: 1 });
      await expect(importer.service.refreshPage([favorite])).rejects.toThrow(
        'queue unavailable',
      );
    } finally {
      await importer.close();
    }
  });

  it('does not look up profiles when source users have no username', async () => {
    const importer = await makeService(
      { kind: 'mapped', trackId: 'track-a' },
      { username: null },
    );
    try {
      await importer.service.refreshPage([favorite]);
      expect(importer.revalidation.revalidate).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });
});

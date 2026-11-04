import { Test } from '@nestjs/testing';
import { LegacyFavoriteImportService } from '../favorites/legacy-favorite-import.service.js';
import { LegacyTrackViewImportService } from '../tracks/legacy-track-view-import.service.js';
import { LegacyRelationshipDomainService } from './legacy-relationship-domain.service.js';
import type { LegacyFavorite, LegacyView } from './legacy-relationships.js';

describe('LegacyRelationshipDomainService', () => {
  it('delegates relationship writes and score refresh through domain services', async () => {
    const favorites = { importPage: vi.fn(async () => ({ imported: 1 })) };
    const views = {
      importPage: vi.fn(async () => ({ imported: 2 })),
      refreshPage: vi.fn(async () => undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LegacyRelationshipDomainService,
        { provide: LegacyFavoriteImportService, useValue: favorites },
        { provide: LegacyTrackViewImportService, useValue: views },
      ],
    }).compile();
    const domain = moduleRef.get(LegacyRelationshipDomainService);
    const favoriteRows: LegacyFavorite[] = [
      {
        id: 'favorite',
        userId: 'user-a',
        trackId: 'old-track',
        createdAt: new Date('2020-01-01Z'),
        updatedAt: new Date('2020-01-02Z'),
      },
    ];
    const viewRows: LegacyView[] = [
      {
        id: 'view',
        userId: null,
        trackId: 'old-track',
        createdAt: new Date('2020-01-01Z'),
        updatedAt: new Date('2020-01-02Z'),
      },
    ];
    try {
      await expect(domain.importFavorites(favoriteRows)).resolves.toEqual({
        imported: 1,
      });
      await expect(domain.importViews(viewRows)).resolves.toEqual({
        imported: 2,
      });
      await expect(domain.refreshViews(viewRows)).resolves.toBeUndefined();
      expect(favorites.importPage).toHaveBeenCalledWith(favoriteRows);
      expect(views.importPage).toHaveBeenCalledWith(viewRows);
      expect(views.refreshPage).toHaveBeenCalledWith(viewRows);
    } finally {
      await moduleRef.close();
    }
  });
});

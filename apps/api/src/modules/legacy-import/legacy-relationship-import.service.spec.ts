import { Test } from '@nestjs/testing';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { LegacyFavoriteImportService } from '../favorites/legacy-favorite-import.service.js';
import { LegacyTrackViewImportService } from '../tracks/legacy-track-view-import.service.js';
import { LegacyImportRepository } from './legacy-import.repository.js';
import { LegacyRelationshipDomainService } from './legacy-relationship-domain.service.js';
import { LegacyRelationshipImportRepository } from './legacy-relationship-import.repository.js';
import { LegacyRelationshipImportService } from './legacy-relationship-import.service.js';
import { LegacySourceRepository } from './legacy-source.repository.js';

const favorite = {
  id: 'favorite-a',
  userId: 'user-a',
  trackId: 'legacy-track-a',
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-02T00:00:00Z'),
};
const view = {
  id: 'view-a',
  trackId: 'legacy-track-a',
  userId: null,
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-02T00:00:00Z'),
};

const makeImporter = async (
  options: {
    progressStatus?: string;
    favoritePage?: (typeof favorite)[];
    viewPage?: (typeof view)[];
    planCheck?: Error;
    sourceError?: Error;
    favoriteError?: Error;
    favoriteRefreshError?: Error;
  } = {},
) => {
  const snapshot = {
    validateRecordingSource: vi.fn(async () => ({ digest: 'recordings' })),
    favoritePage: vi.fn(async (cursor: string | null) =>
      cursor === null ? (options.favoritePage ?? [favorite]) : [],
    ),
    viewPage: vi.fn(async (cursor: string | null) =>
      cursor === null ? (options.viewPage ?? [view]) : [],
    ),
  };
  const source = {
    snapshot: vi.fn(
      async (read: (value: typeof snapshot) => Promise<unknown>) => {
        if (options.sourceError) throw options.sourceError;
        return read(snapshot);
      },
    ),
  };
  const lock = {
    locked: vi.fn(async (run: () => Promise<unknown>) => run()),
  };
  const progress = {
    assertPlanComplete: vi.fn(async () => {
      if (options.planCheck) throw options.planCheck;
    }),
    prepare: vi.fn(async () => ({
      status: options.progressStatus ?? 'incomplete',
      sourceDigest: 'relationships',
      lastFavoriteId: null,
      lastRefreshedFavoriteId: null,
      lastViewId: null,
      lastRefreshedViewId: null,
      acceptedFavorites: 0,
      importedFavorites: 0,
      deduplicatedFavorites: 0,
      importedViews: 0,
      skippedFavorites: 0,
      skippedViews: 0,
    })),
    find: vi.fn(async () => ({
      lastViewId: null,
      lastRefreshedViewId: null,
      lastRefreshedFavoriteId: null,
    })),
    commitFavoritePage: vi.fn(
      async (_cursor: string, _counts: Record<string, number>) => undefined,
    ),
    commitViewPage: vi.fn(
      async (_cursor: string, _counts: Record<string, number>) => undefined,
    ),
    commitRefreshedViewPage: vi.fn(async (_cursor: string) => undefined),
    commitRefreshedFavoritePage: vi.fn(async (_cursor: string) => undefined),
    complete: vi.fn(async () => undefined),
    skippedTracks: vi.fn(async () => []),
  };
  const favoriteImports = {
    importPage: vi.fn(async (_page: (typeof favorite)[]) => {
      if (options.favoriteError) throw options.favoriteError;
      return { accepted: 1, imported: 1, deduplicated: 0, skipped: 0 };
    }),
  };
  const viewImports = {
    importPage: vi.fn(async (_page: (typeof view)[]) => ({
      imported: 1,
      skipped: 0,
    })),
    refreshPage: vi.fn(async (_page: (typeof view)[]) => undefined),
  };
  const domain = {
    importFavorites: vi.fn((page: (typeof favorite)[]) =>
      favoriteImports.importPage(page),
    ),
    importViews: vi.fn((page: (typeof view)[]) => viewImports.importPage(page)),
    refreshFavorites: vi.fn(async (_page: (typeof favorite)[]) => {
      if (options.favoriteRefreshError) throw options.favoriteRefreshError;
    }),
    refreshViews: vi.fn((page: (typeof view)[]) =>
      viewImports.refreshPage(page),
    ),
  };
  const { db, pool } = fakeTransactionalDatabase();
  const moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule],
    providers: [
      LegacyRelationshipImportService,
      { provide: LegacyImportRepository, useValue: lock },
      { provide: LegacyRelationshipImportRepository, useValue: progress },
      { provide: LegacySourceRepository, useValue: source },
      { provide: LegacyRelationshipDomainService, useValue: domain },
      { provide: LegacyFavoriteImportService, useValue: {} },
      { provide: LegacyTrackViewImportService, useValue: {} },
    ],
  })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(DATABASE_POOL)
    .useValue(pool)
    .compile();
  return {
    service: moduleRef.get(LegacyRelationshipImportService),
    lock,
    progress,
    source,
    snapshot,
    domain,
    close: () => moduleRef.close(),
  };
};

describe('LegacyRelationshipImportService', () => {
  it('imports pages, refreshes view scores and reports destination deduplication', async () => {
    const importer = await makeImporter();
    try {
      expect(await importer.service.run()).toEqual({
        status: 'complete',
        acceptedFavorites: 1,
        importedFavorites: 1,
        deduplicatedFavorites: 0,
        importedViews: 1,
        skippedFavorites: 0,
        skippedViews: 0,
        skippedLegacyTracks: [],
        errors: [],
      });
      expect(importer.progress.commitFavoritePage).toHaveBeenCalledWith(
        favorite.id,
        { accepted: 1, imported: 1, deduplicated: 0, skipped: 0 },
      );
      expect(importer.progress.commitViewPage).toHaveBeenCalledWith(view.id, {
        imported: 1,
        skipped: 0,
      });
      expect(importer.domain.refreshViews).toHaveBeenCalledWith([view]);
      expect(importer.domain.refreshFavorites).toHaveBeenCalledWith([favorite]);
      expect(
        importer.progress.commitRefreshedFavoritePage,
      ).toHaveBeenCalledWith(favorite.id);
      expect(importer.progress.complete).toHaveBeenCalledOnce();
    } finally {
      await importer.close();
    }
  });

  it('leaves an unresolved map retryable and reports a sanitized incomplete status', async () => {
    const importer = await makeImporter({
      favoriteError: new Error('RELATIONSHIP_MAP_PENDING'),
    });
    try {
      expect(await importer.service.run()).toMatchObject({
        status: 'incomplete',
        errors: ['RELATIONSHIP_MAP_PENDING'],
      });
      expect(importer.progress.commitFavoritePage).not.toHaveBeenCalled();
      expect(importer.progress.complete).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });

  it('does not advance past a committed favorite page when refresh acceptance fails', async () => {
    const importer = await makeImporter({
      favoriteRefreshError: new Error('queue unavailable'),
    });
    try {
      expect(await importer.service.run()).toMatchObject({
        status: 'incomplete',
        errors: ['RELATIONSHIP_IMPORT_FAILED'],
      });
      expect(importer.progress.commitFavoritePage).toHaveBeenCalledOnce();
      expect(
        importer.progress.commitRefreshedFavoritePage,
      ).not.toHaveBeenCalled();
      expect(importer.progress.complete).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });

  it('does no work after a completed relationship import', async () => {
    const importer = await makeImporter({ progressStatus: 'complete' });
    try {
      expect(await importer.service.run()).toMatchObject({
        status: 'complete',
      });
      expect(importer.domain.importFavorites).not.toHaveBeenCalled();
      expect(importer.domain.refreshFavorites).not.toHaveBeenCalled();
      expect(importer.domain.importViews).not.toHaveBeenCalled();
      expect(importer.domain.refreshViews).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });

  it('does not start before the recording plan matches its frozen source', async () => {
    const importer = await makeImporter({
      planCheck: new Error('SOURCE_CHANGED'),
    });
    try {
      expect(await importer.service.run()).toMatchObject({
        status: 'incomplete',
        errors: ['SOURCE_CHANGED'],
      });
      expect(importer.progress.prepare).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });

  it('sanitizes source connection failures', async () => {
    const importer = await makeImporter({
      sourceError: new Error('secret-url'),
    });
    try {
      expect(await importer.service.run()).toMatchObject({
        status: 'incomplete',
        errors: ['RELATIONSHIP_IMPORT_FAILED'],
      });
    } finally {
      await importer.close();
    }
  });
});

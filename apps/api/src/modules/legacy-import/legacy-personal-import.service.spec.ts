import { Test } from '@nestjs/testing';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { LegacyImportRepository } from './legacy-import.repository.js';
import type { LegacyPracticeDay, LegacyVisibility } from './legacy-personal.js';
import { LegacyPersonalImportService } from './legacy-personal-import.service.js';
import { LegacySourceRepository } from './legacy-source.repository.js';

const day: LegacyPracticeDay = {
  id: 'day-a',
  userId: 'user-a',
  day: '2024-01-01',
  listenedSeconds: 600,
  completed: true,
  completedAt: new Date('2024-01-01T00:10:00Z'),
  lastHeartbeatAt: new Date('2024-01-01T00:10:00Z'),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:10:00Z'),
};

const makeImporter = async (
  options: {
    progress?: object;
    visibility?: LegacyVisibility[];
    sourceFails?: boolean;
  } = {},
) => {
  const snapshot = {
    practicePage: vi.fn(async (cursor: string | null) =>
      cursor === null ? [day] : [],
    ),
    visibility: vi.fn(async () => options.visibility ?? []),
  };
  const source = {
    snapshot: vi.fn(
      async (read: (value: typeof snapshot) => Promise<unknown>) => {
        if (options.sourceFails) throw new Error('source secret');
        return read(snapshot);
      },
    ),
  };
  const repository = {
    locked: vi.fn(async (run: () => Promise<unknown>) => run()),
    personalProgress: vi.fn(
      async () =>
        options.progress ?? {
          status: 'incomplete',
          lastPracticeId: null,
          importedPracticeDays: 0,
        },
    ),
    importPracticeDay: vi.fn(async () => undefined),
    updateLegacyVisibility: vi.fn(async () => undefined),
    completePersonal: vi.fn(async () => undefined),
  };
  const { db, pool } = fakeTransactionalDatabase();
  const moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule],
    providers: [
      LegacyPersonalImportService,
      { provide: LegacyImportRepository, useValue: repository },
      { provide: LegacySourceRepository, useValue: source },
    ],
  })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(DATABASE_POOL)
    .useValue(pool)
    .compile();
  return {
    service: moduleRef.get(LegacyPersonalImportService),
    repository,
    source,
    snapshot,
    close: () => moduleRef.close(),
  };
};

describe('LegacyPersonalImportService', () => {
  it('imports practice days and applies the most restrictive visibility on replayable writes', async () => {
    const visibility: LegacyVisibility[] = [
      { userId: 'user-a', key: 'FAVORITE_TRACKS', value: 'PUBLIC' },
      { userId: 'user-a', key: 'FAVORITE_TRACKS', value: 'ME_ONLY' },
      { userId: 'user-a', key: 'RECENT_VIEWS', value: 'ME_ONLY' },
    ];
    const importer = await makeImporter({ visibility });
    try {
      expect(await importer.service.run()).toEqual({
        status: 'complete',
        importedPracticeDays: 1,
        errors: [],
      });
      expect(importer.repository.importPracticeDay).toHaveBeenCalledWith(day);
      expect(importer.repository.updateLegacyVisibility).toHaveBeenCalledWith(
        'user-a',
        {
          showFavoritesSection: false,
          showSummarySection: false,
          showPracticeHistorySection: false,
        },
      );
      expect(importer.repository.completePersonal).toHaveBeenCalledOnce();
    } finally {
      await importer.close();
    }
  });

  it('does not rewrite days or visibility after a completed import', async () => {
    const importer = await makeImporter({
      progress: { status: 'complete', importedPracticeDays: 1 },
    });
    try {
      expect(await importer.service.run()).toMatchObject({
        status: 'complete',
      });
      expect(importer.repository.importPracticeDay).not.toHaveBeenCalled();
      expect(importer.repository.updateLegacyVisibility).not.toHaveBeenCalled();
    } finally {
      await importer.close();
    }
  });

  it('sanitizes source failures and keeps the report incomplete', async () => {
    const importer = await makeImporter({ sourceFails: true });
    try {
      expect(await importer.service.run()).toEqual({
        status: 'incomplete',
        importedPracticeDays: 0,
        errors: ['PERSONAL_IMPORT_FAILED'],
      });
    } finally {
      await importer.close();
    }
  });
});

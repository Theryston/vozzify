import { Test, type TestingModule } from '@nestjs/testing';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { LegacyImportRepository } from './legacy-import.repository.js';
import { LegacyImportService } from './legacy-import.service.js';
import { LegacySourceRepository } from './legacy-source.repository.js';
import { type LegacyUser, legacyUserSchema } from './legacy-user.js';

const USER: LegacyUser = legacyUserSchema.parse({
  id: 'old-user',
  role: 'USER',
  name: null,
  email: 'ada@example.com',
  username: null,
  password: null,
  emailVerifiedAt: null,
  image: null,
  dailyPracticeTargetSeconds: null,
  createdAt: '2020-01-01T00:00:00Z',
  updatedAt: '2020-01-01T00:00:00Z',
  accounts: [
    {
      provider: 'google',
      accountId: 'sub',
      accessToken: null,
      refreshToken: null,
      idToken: null,
      scope: null,
      expiresAt: null,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
  ],
});

describe('operator User import', () => {
  const snapshot = {
    validate: vi.fn(),
    page: vi.fn(),
  };
  const repository = {
    locked: vi.fn(async (run: () => Promise<unknown>) => run()),
    prepare: vi.fn(),
    resume: vi.fn(),
    importUser: vi.fn(),
    complete: vi.fn(),
  };
  const source = {
    snapshot: vi.fn(async (run: (value: typeof snapshot) => Promise<unknown>) =>
      run(snapshot),
    ),
  };
  let service: LegacyImportService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    snapshot.validate.mockResolvedValue({
      digest: 'frozen-digest',
      users: 1,
      accounts: 1,
      errors: [],
    });
    snapshot.page
      .mockReset()
      .mockResolvedValueOnce([USER])
      .mockResolvedValue([]);
    repository.prepare.mockResolvedValue({
      importedUsers: 0,
      importedAccounts: 0,
      lastUserId: null,
    });
    repository.importUser.mockReset().mockResolvedValue(undefined);
    repository.complete.mockReset().mockResolvedValue(undefined);
    const { db, pool } = fakeTransactionalDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        LegacyImportService,
        { provide: LegacyImportRepository, useValue: repository },
        { provide: LegacySourceRepository, useValue: source },
      ],
    })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();
    service = moduleRef.get(LegacyImportService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('marks completion only after every required identity has committed', async () => {
    expect(await service.run()).toEqual({
      status: 'complete',
      sourceUsers: 1,
      sourceAccounts: 1,
      importedUsers: 1,
      importedAccounts: 1,
      errors: [],
    });
    expect(repository.importUser).toHaveBeenCalledWith(USER);
    expect(repository.complete).toHaveBeenCalledOnce();
    expect(snapshot.page.mock.calls).toEqual([[null], ['old-user']]);
  });

  it('does not start writing when preflight reports an invalid identity', async () => {
    snapshot.validate.mockResolvedValue({
      digest: 'invalid',
      users: 1,
      accounts: 0,
      errors: ['INVALID_USER_OR_IDENTITY:a'],
    });
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      errors: ['INVALID_USER_OR_IDENTITY:a'],
    });
    expect(repository.prepare).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('reports durable partial progress without leaking a failed SQL parameter', async () => {
    repository.prepare.mockResolvedValue({
      importedUsers: 4,
      importedAccounts: 6,
      lastUserId: 'previous',
    });
    repository.importUser.mockRejectedValue(
      new Error('secret-hash postgres://password@host'),
    );
    const report = await service.run();
    expect(report).toMatchObject({
      status: 'incomplete',
      importedUsers: 4,
      importedAccounts: 6,
      errors: ['USER_IMPORT_FAILED'],
    });
    expect(JSON.stringify(report)).not.toContain('secret-hash');
    expect(repository.complete).not.toHaveBeenCalled();
    expect(snapshot.page).toHaveBeenCalledWith('previous');
  });

  it.each([
    'SOURCE_CHANGED',
    'DESTINATION_NOT_EMPTY',
    'IMPORT_ALREADY_RUNNING',
    'LEGACY_DATABASE_URL_REQUIRED',
  ])('reports the safe operator error %s', async (code) => {
    repository.prepare.mockRejectedValue(new Error(code));
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      errors: [code],
    });
  });

  it('does not report success when cleanup fails after all Users committed', async () => {
    repository.locked.mockImplementationOnce(
      async (run: () => Promise<unknown>) => {
        await run();
        throw new Error('connection lost during cleanup');
      },
    );
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      importedUsers: 1,
      importedAccounts: 1,
      errors: ['USER_IMPORT_FAILED'],
    });
  });

  it('sanitizes non-Error failures too', async () => {
    repository.prepare.mockRejectedValue('raw-secret');
    expect(await service.run()).toMatchObject({
      status: 'incomplete',
      errors: ['USER_IMPORT_FAILED'],
    });
  });
});

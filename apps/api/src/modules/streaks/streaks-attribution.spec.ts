import * as NestTesting from '@nestjs/testing';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PrivateTrackPracticeAccessService } from '../private-tracks/private-track-practice-access.service.js';
import { UsersService } from '../users/users.service.js';
import { StreaksRepository } from './streaks.repository.js';
import { StreaksService } from './streaks.service.js';

const access = { assertCanPractice: vi.fn() };

const { repository, users } = vi.hoisted(() => ({
  repository: {
    findDay: vi.fn(),
    lockDay: vi.fn(),
    saveHeartbeat: vi.fn(),
    findCompletedDays: vi.fn(),
    recordAttributedHeartbeat: vi.fn(),
  },
  users: {
    getPracticeSettings: vi.fn(),
    lockPracticeSettings: vi.fn(),
    recordPracticeHeartbeat: vi.fn(),
  },
}));

describe('StreaksService view attribution', () => {
  let service: StreaksService;
  let moduleRef: NestTesting.TestingModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    const settings = {
      dailyPracticeTargetSeconds: null,
      timeZone: 'UTC',
      lastPracticeHeartbeatAt: null,
    };
    users.lockPracticeSettings.mockResolvedValue(settings);
    repository.lockDay.mockResolvedValue({
      id: 'day-1',
      day: '2026-10-23',
      listenedSeconds: 0,
      completed: false,
      lastHeartbeatAt: null,
    });
    repository.findCompletedDays.mockResolvedValue([]);
    const { db, pool } = fakeTransactionalDatabase();
    const builder = NestTesting.Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        StreaksService,
        { provide: StreaksRepository, useValue: repository },
        { provide: UsersService, useValue: users },
        { provide: PrivateTrackPracticeAccessService, useValue: access },
      ],
    });
    builder.overrideProvider(DATABASE_POOL).useValue(pool);
    builder.overrideProvider(DATABASE).useValue(db);
    moduleRef = await builder.compile();
    service = moduleRef.get(StreaksService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('stores the credited portion against the supplied view', async () => {
    await service.heartbeat('user-1', {
      elapsedSeconds: 5,
      timeZone: 'UTC',
      viewId: 'view-1',
    });

    expect(repository.recordAttributedHeartbeat).toHaveBeenCalledWith({
      userId: 'user-1',
      viewId: 'view-1',
      elapsedSeconds: 5,
      creditedSeconds: 5,
    });
  });

  it('checks private access and leaves its credited time unattributed', async () => {
    const result = await service.heartbeat('user-1', {
      elapsedSeconds: 5,
      timeZone: 'UTC',
      privateTrackId: 'private-track',
      viewId: 'public-view',
    });

    expect(access.assertCanPractice).toHaveBeenCalledWith(
      'user-1',
      'private-track',
    );
    expect(result.creditedSeconds).toBe(5);
    expect(repository.recordAttributedHeartbeat).not.toHaveBeenCalled();
  });
});

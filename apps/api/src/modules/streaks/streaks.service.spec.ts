import { Test, type TestingModule } from '@nestjs/testing';
import { fakeTransactionalDatabase } from '../../../test/utils/fake-transactional-db.js';
import { DATABASE, DATABASE_POOL } from '../../database/database.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PrivateTrackPracticeAccessService } from '../private-tracks/private-track-practice-access.service.js';
import { UsersService } from '../users/users.service.js';
import { StreaksRepository } from './streaks.repository.js';
import { StreaksService } from './streaks.service.js';

const repository = {
  findDay: vi.fn(),
  lockDay: vi.fn(),
  saveHeartbeat: vi.fn(),
  findCompletedDays: vi.fn(),
};
const users = {
  getPracticeSettings: vi.fn(),
  lockPracticeSettings: vi.fn(),
  recordPracticeHeartbeat: vi.fn(),
};

const NOW = new Date('2026-03-10T12:00:00Z');
const day = (overrides = {}) => ({
  id: 'day-1',
  day: '2026-03-10',
  listenedSeconds: 0,
  completed: false,
  lastHeartbeatAt: null,
  ...overrides,
});

describe('StreaksService', () => {
  let service: StreaksService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const settings = {
      dailyPracticeTargetSeconds: null,
      timeZone: 'UTC',
      lastPracticeHeartbeatAt: null,
    };
    users.getPracticeSettings.mockResolvedValue(settings);
    users.lockPracticeSettings.mockResolvedValue(settings);
    repository.findCompletedDays.mockResolvedValue([]);
    const { db, pool } = fakeTransactionalDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        StreaksService,
        { provide: StreaksRepository, useValue: repository },
        { provide: UsersService, useValue: users },
        { provide: PrivateTrackPracticeAccessService, useValue: {} },
      ],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .overrideProvider(DATABASE)
      .useValue(db)
      .compile();
    service = moduleRef.get(StreaksService);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await moduleRef.close();
  });

  it('reads the status against the default target without a stored day', async () => {
    repository.findDay.mockResolvedValue(undefined);

    await expect(service.getStatus('user-1', undefined)).resolves.toEqual({
      day: '2026-03-10',
      listenedSeconds: 0,
      targetSeconds: 300,
      completedToday: false,
      currentStreakDays: 0,
    });
  });

  it('reads the day in the zone asked for before the stored one', async () => {
    users.getPracticeSettings.mockResolvedValue({
      dailyPracticeTargetSeconds: 900,
      timeZone: 'Asia/Tokyo',
      lastPracticeHeartbeatAt: null,
    });
    vi.setSystemTime(new Date('2026-03-10T16:00:00Z'));
    repository.findDay.mockResolvedValue(undefined);

    const stored = await service.getStatus('user-1', undefined);
    const asked = await service.getStatus('user-1', 'America/Sao_Paulo');

    expect(stored.day).toBe('2026-03-11');
    expect(asked.day).toBe('2026-03-10');
    expect(asked.targetSeconds).toBe(900);
  });

  it('caps the listened seconds at the target', async () => {
    users.getPracticeSettings.mockResolvedValue({
      dailyPracticeTargetSeconds: 300,
      timeZone: null,
      lastPracticeHeartbeatAt: null,
    });
    repository.findDay.mockResolvedValue(day({ listenedSeconds: 500 }));

    await expect(service.getStatus('user-1', undefined)).resolves.toMatchObject(
      { listenedSeconds: 300, completedToday: false },
    );
  });

  it('reads a legacy non-preset target as the fallback', async () => {
    users.getPracticeSettings.mockResolvedValue({
      dailyPracticeTargetSeconds: 40,
      timeZone: null,
      lastPracticeHeartbeatAt: null,
    });
    repository.findDay.mockResolvedValue(day({ listenedSeconds: 500 }));

    await expect(service.getStatus('user-1', undefined)).resolves.toMatchObject(
      { targetSeconds: 300, listenedSeconds: 300, completedToday: false },
    );
  });

  it('keeps the time zone of the heartbeat and moves the practice clock', async () => {
    repository.lockDay.mockResolvedValue(day());

    await service.heartbeat('user-1', {
      elapsedSeconds: 5,
      timeZone: 'Asia/Tokyo',
    });

    expect(users.recordPracticeHeartbeat).toHaveBeenCalledWith('user-1', {
      timeZone: 'Asia/Tokyo',
      clockAt: NOW,
    });
  });

  it('checks the heartbeat against the clock of the User, not of the day', async () => {
    users.lockPracticeSettings.mockResolvedValue({
      dailyPracticeTargetSeconds: null,
      timeZone: 'UTC',
      lastPracticeHeartbeatAt: new Date(NOW.getTime() - 4_000),
    });
    repository.lockDay.mockResolvedValue(day());

    const result = await service.heartbeat('user-1', {
      elapsedSeconds: 20,
      timeZone: 'Pacific/Kiritimati',
    });

    expect(result.creditedSeconds).toBe(4);
  });

  it('completes the day on the heartbeat that reaches the target', async () => {
    users.lockPracticeSettings.mockResolvedValue({
      dailyPracticeTargetSeconds: 300,
      timeZone: 'UTC',
      lastPracticeHeartbeatAt: null,
    });
    repository.lockDay.mockResolvedValue(day({ listenedSeconds: 290 }));

    const result = await service.heartbeat('user-1', {
      elapsedSeconds: 15,
      timeZone: 'UTC',
    });

    expect(result).toMatchObject({ justCompleted: true, creditedSeconds: 15 });
    expect(repository.saveHeartbeat).toHaveBeenCalledWith('day-1', {
      listenedSeconds: 305,
      heartbeatAt: NOW,
      completesDay: true,
    });
  });

  it('does not complete a day twice', async () => {
    repository.lockDay.mockResolvedValue(
      day({ listenedSeconds: 400, completed: true }),
    );

    const result = await service.heartbeat('user-1', {
      elapsedSeconds: 5,
      timeZone: 'UTC',
    });

    expect(result.justCompleted).toBe(false);
    expect(repository.saveHeartbeat).toHaveBeenCalledWith(
      'day-1',
      expect.objectContaining({ completesDay: false }),
    );
  });

  it('writes nothing for a heartbeat with less than a second', async () => {
    repository.findDay.mockResolvedValue(undefined);

    const result = await service.heartbeat('user-1', {
      elapsedSeconds: 0.4,
      timeZone: 'UTC',
    });

    expect(result.creditedSeconds).toBe(0);
    expect(repository.lockDay).not.toHaveBeenCalled();
    expect(repository.saveHeartbeat).not.toHaveBeenCalled();
    expect(users.recordPracticeHeartbeat).not.toHaveBeenCalled();
  });
});

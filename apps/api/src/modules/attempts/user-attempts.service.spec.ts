import { Test } from '@nestjs/testing';
import { AppException } from '../../common/errors/app-exception.js';
import { PrivateTrackPracticeAccessService } from '../private-tracks/private-track-practice-access.service.js';
import { UsersService } from '../users/users.service.js';
import { AttemptsRepository } from './attempts.repository.js';
import { encodeOwnAttemptCursor } from './own-attempt-cursor.js';
import { UserAttemptsService } from './user-attempts.service.js';

const attempts = { listHistory: vi.fn() };
const users = { findUserIdByUsername: vi.fn() };

const run = (id: string, createdAt: string, overrides = {}) => ({
  id,
  userId: 'user-1',
  trackId: `track-${id}`,
  difficulty: 'NORMAL' as const,
  octaveMode: 'ANY' as const,
  transposeSemitones: 0,
  speed: 1,
  accuracy: 0.8,
  coverage: 0.95,
  forwardSkip: false,
  bleedSuspected: false,
  startedAt: new Date('2026-10-16T10:00:00.000Z'),
  endedAt: new Date('2026-10-16T10:04:00.000Z'),
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
  ...overrides,
});

/** A joined row, as the repository answers it: the run and its Track. */
const joined = (attempt: ReturnType<typeof run>) => ({
  attempt,
  track: {
    id: attempt.trackId,
    title: `Song ${attempt.id}`,
    coverUrl: null,
    artistCredit: [{ name: 'Artist', joinPhrase: '' }],
  },
});

describe('UserAttemptsService', () => {
  let service: UserAttemptsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserAttemptsService,
        { provide: AttemptsRepository, useValue: attempts },
        { provide: UsersService, useValue: users },
        { provide: PrivateTrackPracticeAccessService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(UserAttemptsService);
  });

  it('answers NOT_FOUND for a username no User has', async () => {
    users.findUserIdByUsername.mockResolvedValue(undefined);

    const failure = await service
      .listHistory('nobody', { limit: 20 })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppException);
    expect(failure).toMatchObject({ code: 'NOT_FOUND' });
    expect(attempts.listHistory).not.toHaveBeenCalled();
  });

  it('answers an empty page for a User with no runs', async () => {
    users.findUserIdByUsername.mockResolvedValue('user-1');
    attempts.listHistory.mockResolvedValue([]);

    await expect(service.listHistory('ada', { limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('looks the username up as given, the lookup lowercases it', async () => {
    users.findUserIdByUsername.mockResolvedValue('user-1');
    attempts.listHistory.mockResolvedValue([]);

    await service.listHistory('Ada', { limit: 20 });

    expect(users.findUserIdByUsername).toHaveBeenCalledWith('Ada');
    expect(attempts.listHistory).toHaveBeenCalledWith({
      userId: 'user-1',
      after: undefined,
      limit: 21,
    });
  });

  it('answers each run with its Track and keeps the bleed flag as saved', async () => {
    users.findUserIdByUsername.mockResolvedValue('user-1');
    const suspected = run('a1', '2026-10-17T10:00:00.000Z', {
      bleedSuspected: true,
    });
    attempts.listHistory.mockResolvedValue([joined(suspected)]);

    const page = await service.listHistory('ada', { limit: 20 });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'a1',
        bleedSuspected: true,
        createdAt: '2026-10-17T10:00:00.000Z',
        track: {
          id: 'track-a1',
          title: 'Song a1',
          coverUrl: null,
          artistCredit: [{ name: 'Artist', joinPhrase: '' }],
        },
      }),
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('answers a cursor for the page after when more runs follow', async () => {
    users.findUserIdByUsername.mockResolvedValue('user-1');
    attempts.listHistory.mockResolvedValue([
      joined(run('a2', '2026-10-17T10:00:00.000Z')),
      joined(run('a1', '2026-10-16T10:00:00.000Z')),
    ]);

    const page = await service.listHistory('ada', { limit: 1 });

    expect(page.items.map((item) => item.id)).toEqual(['a2']);
    expect(page.nextCursor).toBe(
      encodeOwnAttemptCursor({
        createdAt: '2026-10-17T10:00:00.000Z',
        attemptId: 'a2',
      }),
    );
  });

  it('resumes after the cursor it was given', async () => {
    users.findUserIdByUsername.mockResolvedValue('user-1');
    attempts.listHistory.mockResolvedValue([]);
    const cursor = encodeOwnAttemptCursor({
      createdAt: '2026-10-17T10:00:00.000Z',
      attemptId: 'a2',
    });

    await service.listHistory('ada', { cursor, limit: 20 });

    expect(attempts.listHistory).toHaveBeenCalledWith({
      userId: 'user-1',
      after: { createdAt: '2026-10-17T10:00:00.000Z', attemptId: 'a2' },
      limit: 21,
    });
  });
});

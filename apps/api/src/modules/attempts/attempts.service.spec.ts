import { Test } from '@nestjs/testing';
import { AppException } from '../../common/errors/app-exception.js';
import { TracksService } from '../tracks/tracks.service.js';
import { AttemptsRepository } from './attempts.repository.js';
import { AttemptsService } from './attempts.service.js';

const repository = {
  insert: vi.fn(),
  bestAccuracies: vi.fn(),
  listOwn: vi.fn(),
  listVocalRangeGroups: vi.fn(),
  listVocalRangeEvidenceGroups: vi.fn(),
};
const tracks = { assertTrackExists: vi.fn() };

const body = {
  difficulty: 'NORMAL',
  octaveMode: 'ANY',
  transposeSemitones: 0,
  speed: 1,
  accuracy: 0.8,
  coverage: 0.95,
  forwardSkip: false,
  bleedSuspected: false,
  startedAt: '2026-10-16T10:00:00.000Z',
  endedAt: '2026-10-16T10:04:00.000Z',
} as const;

const row = {
  id: 'attempt-1',
  userId: 'user-1',
  trackId: 'track-1',
  difficulty: 'NORMAL',
  octaveMode: 'ANY',
  transposeSemitones: 0,
  speed: 1,
  accuracy: 0.8,
  coverage: 0.95,
  forwardSkip: false,
  bleedSuspected: false,
  startedAt: new Date('2026-10-16T10:00:00.000Z'),
  endedAt: new Date('2026-10-16T10:04:00.000Z'),
  createdAt: new Date('2026-10-16T10:04:01.000Z'),
  updatedAt: new Date('2026-10-16T10:04:01.000Z'),
};

describe('AttemptsService', () => {
  let service: AttemptsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AttemptsService,
        { provide: AttemptsRepository, useValue: repository },
        { provide: TracksService, useValue: tracks },
      ],
    }).compile();
    service = moduleRef.get(AttemptsService);
  });

  it('counts distinct qualifying Track and transpose groups for voice confidence', async () => {
    repository.listVocalRangeEvidenceGroups.mockResolvedValue([
      {
        trackId: 'track-1',
        trackVocalRangeLowest: 48,
        trackVocalRangeHighest: 60,
        transposeSemitones: 0,
        forwardSkip: false,
        bleedSuspected: false,
        bestAccuracy: 0.85,
      },
      {
        trackId: 'track-1',
        trackVocalRangeLowest: 48,
        trackVocalRangeHighest: 60,
        transposeSemitones: 0,
        forwardSkip: false,
        bleedSuspected: false,
        bestAccuracy: 0.95,
      },
      {
        trackId: 'track-1',
        trackVocalRangeLowest: 48,
        trackVocalRangeHighest: 60,
        transposeSemitones: 2,
        forwardSkip: false,
        bleedSuspected: false,
        bestAccuracy: 0.9,
      },
      {
        trackId: 'track-2',
        trackVocalRangeLowest: 40,
        trackVocalRangeHighest: 55,
        transposeSemitones: 0,
        forwardSkip: false,
        bleedSuspected: false,
        bestAccuracy: 0.9,
      },
      {
        trackId: 'low-accuracy',
        trackVocalRangeLowest: 48,
        trackVocalRangeHighest: 60,
        transposeSemitones: 0,
        forwardSkip: false,
        bleedSuspected: false,
        bestAccuracy: 0.84,
      },
      {
        trackId: 'skipped',
        trackVocalRangeLowest: 48,
        trackVocalRangeHighest: 60,
        transposeSemitones: 0,
        forwardSkip: true,
        bleedSuspected: false,
        bestAccuracy: 0.99,
      },
      {
        trackId: 'bleed',
        trackVocalRangeLowest: 48,
        trackVocalRangeHighest: 60,
        transposeSemitones: 0,
        forwardSkip: false,
        bleedSuspected: true,
        bestAccuracy: 0.99,
      },
      {
        trackId: 'no-range',
        trackVocalRangeLowest: null,
        trackVocalRangeHighest: null,
        transposeSemitones: 0,
        forwardSkip: false,
        bleedSuspected: false,
        bestAccuracy: 0.99,
      },
    ]);

    await expect(service.vocalRangeEvidenceCount('user-1')).resolves.toBe(3);
  });

  it('saves a valid run of a Track that exists', async () => {
    tracks.assertTrackExists.mockResolvedValue(undefined);
    repository.insert.mockResolvedValue(row);

    const attempt = await service.submitAttempt('user-1', 'track-1', {
      ...body,
    });

    expect(repository.insert).toHaveBeenCalledWith({
      userId: 'user-1',
      trackId: 'track-1',
      difficulty: 'NORMAL',
      octaveMode: 'ANY',
      transposeSemitones: 0,
      speed: 1,
      accuracy: 0.8,
      coverage: 0.95,
      forwardSkip: false,
      bleedSuspected: false,
      startedAt: new Date('2026-10-16T10:00:00.000Z'),
      endedAt: new Date('2026-10-16T10:04:00.000Z'),
    });
    expect(attempt).toMatchObject({
      id: 'attempt-1',
      trackId: 'track-1',
      accuracy: 0.8,
    });
  });

  it('refuses a run that skipped forward without saving it', async () => {
    tracks.assertTrackExists.mockResolvedValue(undefined);

    const failure = service
      .submitAttempt('user-1', 'track-1', {
        ...body,
        coverage: 1,
        forwardSkip: true,
      })
      .catch((error) => error);

    await expect(failure).resolves.toBeInstanceOf(AppException);
    await expect(failure).resolves.toMatchObject({
      code: 'ATTEMPT_REJECTED',
      details: { reason: 'FORWARD_SKIP' },
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('refuses a run under 90% coverage without saving it', async () => {
    tracks.assertTrackExists.mockResolvedValue(undefined);

    await expect(
      service.submitAttempt('user-1', 'track-1', {
        ...body,
        coverage: 0.89,
      }),
    ).rejects.toMatchObject({
      code: 'ATTEMPT_REJECTED',
      details: { reason: 'COVERAGE' },
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('saves nothing for a Track that is missing or moved', async () => {
    const moved = new AppException('RESOURCE_MOVED', 'Track moved', {
      id: 'new',
    });
    tracks.assertTrackExists.mockRejectedValue(moved);

    await expect(
      service.submitAttempt('user-1', 'old', { ...body }),
    ).rejects.toBe(moved);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('reads the best accuracy per difficulty', async () => {
    tracks.assertTrackExists.mockResolvedValue(undefined);
    repository.bestAccuracies.mockResolvedValue([
      { difficulty: 'NORMAL', accuracy: 0.8 },
      { difficulty: 'HARD', accuracy: 0.5 },
    ]);

    await expect(service.bestScores('user-1', 'track-1')).resolves.toEqual({
      EASY: null,
      NORMAL: 0.8,
      HARD: 0.5,
    });
  });

  it('lists the own attempts newest first, with a cursor', async () => {
    const second = { ...row, id: 'attempt-2' };
    repository.listOwn.mockResolvedValue([row, second]);

    const page = await service.listOwn('user-1', { limit: 1 });

    expect(repository.listOwn).toHaveBeenCalledWith({
      userId: 'user-1',
      after: undefined,
      limit: 2,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'attempt-1' });
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('ends the last page with a null cursor', async () => {
    repository.listOwn.mockResolvedValue([row]);

    const page = await service.listOwn('user-1', { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});

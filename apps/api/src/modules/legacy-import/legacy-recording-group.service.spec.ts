import { Test } from '@nestjs/testing';
import { testMbid } from '../../../test/utils/factories.js';
import { TrackMigrationService } from '../tracks/track-migration.service.js';
import { LegacyRecordingGroupRepository } from './legacy-recording-group.repository.js';
import { LegacyRecordingGroupService } from './legacy-recording-group.service.js';

const MBID = testMbid(1);
const group = {
  sourceDigest: 'frozen',
  userId: 'first',
  contributedAt: new Date(0),
  legacyTrackIds: ['old'],
};
const prepared = { trackId: 'track', initialProcessingId: 'initial' };
const progress = {
  id: MBID,
  sourceDigest: 'frozen',
  ...prepared,
  processingId: 'current',
};

describe('LegacyRecordingGroupService', () => {
  const groups = {
    group: vi.fn(),
    find: vi.fn(),
    acknowledge: vi.fn(),
    acknowledgeRetry: vi.fn(),
  };
  const tracks = { prepare: vi.fn(), start: vi.fn(), retry: vi.fn() };
  let service: LegacyRecordingGroupService;
  beforeEach(async () => {
    vi.resetAllMocks();
    groups.group.mockResolvedValue(group);
    groups.find.mockResolvedValue(progress);
    tracks.prepare.mockResolvedValue(prepared);
    tracks.retry.mockResolvedValue('next');
    const module = await Test.createTestingModule({
      providers: [
        LegacyRecordingGroupService,
        { provide: LegacyRecordingGroupRepository, useValue: groups },
        { provide: TrackMigrationService, useValue: tracks },
      ],
    }).compile();
    service = module.get(LegacyRecordingGroupService);
  });

  it('prepares historical attribution from the plan before acknowledging, without starting', async () => {
    expect(await service.prepare(MBID)).toEqual(prepared);
    expect(tracks.prepare).toHaveBeenCalledWith({
      recordingMbid: MBID,
      userId: group.userId,
      contributedAt: group.contributedAt,
      legacyTrackIds: group.legacyTrackIds,
    });
    expect(groups.acknowledge).toHaveBeenCalledWith({
      id: MBID,
      sourceDigest: 'frozen',
      ...prepared,
      processingId: 'initial',
    });
    expect(tracks.start).not.toHaveBeenCalled();
  });

  it('does not acknowledge a preparation whose metadata enqueue failed', async () => {
    tracks.prepare.mockRejectedValue(new Error('queue unavailable'));
    await expect(service.prepare(MBID)).rejects.toThrow('queue unavailable');
    expect(groups.acknowledge).not.toHaveBeenCalled();
  });

  it('starts only an acknowledged group', async () => {
    await service.start(MBID);
    expect(tracks.start).toHaveBeenCalledWith('track', 'current');
  });

  it.each([
    ['missing', undefined],
    ['changed', { ...progress, sourceDigest: 'other' }],
  ])('refuses %s progress before starting', async (_, value) => {
    groups.find.mockResolvedValue(value);
    await expect(service.start(MBID)).rejects.toThrow();
    expect(tracks.start).not.toHaveBeenCalled();
  });

  it('acknowledges the new attempt before explicitly starting it', async () => {
    await service.retry(MBID);
    expect(tracks.retry).toHaveBeenCalledWith('track', 'current', MBID);
    expect(groups.acknowledgeRetry).toHaveBeenCalledWith(
      MBID,
      'current',
      'next',
    );
    expect(tracks.start).toHaveBeenCalledWith('track', 'next');
  });

  it('leaves a committed retry recoverable when acknowledgement fails', async () => {
    groups.acknowledgeRetry.mockRejectedValue(new Error('interrupted'));
    await expect(service.retry(MBID)).rejects.toThrow('interrupted');
    expect(tracks.start).not.toHaveBeenCalled();
  });
});

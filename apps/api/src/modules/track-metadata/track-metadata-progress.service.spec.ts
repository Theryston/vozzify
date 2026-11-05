import { describe, expect, it, vi } from 'vitest';
import { TrackMetadataProgressRepository } from './track-metadata-progress.repository.js';
import { TrackMetadataProgressService } from './track-metadata-progress.service.js';

describe('TrackMetadataProgressService', () => {
  it('persists each worker outcome through its repository', async () => {
    const markTrack = vi.fn().mockResolvedValue(undefined);
    const service = new TrackMetadataProgressService({
      markTrack,
      findStatuses: vi.fn().mockResolvedValue([]),
    } as unknown as TrackMetadataProgressRepository);

    await service.markTrack('track-1', 'failed');

    expect(markTrack).toHaveBeenCalledWith('track-1', 'failed');
  });

  it('normalizes stored statuses and defaults unknown values to pending', async () => {
    const service = new TrackMetadataProgressService({
      markTrack: vi.fn(),
      findStatuses: vi.fn().mockResolvedValue([
        { trackId: 'track-1', status: 'completed' },
        { trackId: 'track-2', status: 'failed' },
        { trackId: 'track-3', status: 'unexpected' },
      ]),
    } as unknown as TrackMetadataProgressRepository);

    await expect(
      service.findStatuses(['track-1', 'track-2', 'track-3']),
    ).resolves.toEqual(
      new Map([
        ['track-1', 'completed'],
        ['track-2', 'failed'],
        ['track-3', 'pending'],
      ]),
    );
  });

  it('returns no statuses for an empty Track set', async () => {
    const findStatuses = vi.fn().mockResolvedValue([]);
    const service = new TrackMetadataProgressService({
      markTrack: vi.fn(),
      findStatuses,
    } as unknown as TrackMetadataProgressRepository);

    await expect(service.findStatuses([])).resolves.toEqual(new Map());
    expect(findStatuses).toHaveBeenCalledWith([]);
  });
});

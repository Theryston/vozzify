import { PrivateTrackProcessingService } from './private-track-processing.service.js';
import { PrivateTrackWorkflowService } from './private-track-workflow.service.js';
import { PrivateTracksService } from './private-tracks.service.js';

describe('PrivateTrackWorkflowService', () => {
  const privateTrack = {
    id: 'private-track-1',
    title: 'Song',
    artist: 'Singer',
    durationMs: 1_000,
    createdAt: '2026-01-02T03:04:05.000Z',
  };
  const tracks = { submit: vi.fn(), prepareRetry: vi.fn() };
  const processing = { enqueue: vi.fn() };
  let service: PrivateTrackWorkflowService;

  beforeEach(() => {
    vi.clearAllMocks();
    tracks.submit.mockResolvedValue(privateTrack);
    processing.enqueue.mockResolvedValue(undefined);
    service = new PrivateTrackWorkflowService(
      tracks as unknown as PrivateTracksService,
      processing as unknown as PrivateTrackProcessingService,
    );
  });

  it('saves the private Track before queuing processing', async () => {
    await expect(
      service.submit('user-1', {
        path: '/tmp/audio.wav',
        originalname: 'audio.wav',
      }),
    ).resolves.toEqual(privateTrack);
    expect(tracks.submit).toHaveBeenCalledWith('user-1', {
      path: '/tmp/audio.wav',
      originalname: 'audio.wav',
    });
    expect(processing.enqueue).toHaveBeenCalledWith('user-1', privateTrack.id);
  });

  it('returns the persisted Track if enqueue fails for reconciliation', async () => {
    processing.enqueue.mockRejectedValue(new Error('Redis unavailable'));
    await expect(
      service.submit('user-1', {
        path: '/tmp/audio.wav',
        originalname: 'audio.wav',
      }),
    ).resolves.toEqual(privateTrack);
  });

  it('accepts a persisted retry even if its immediate queue operation fails', async () => {
    const state = { status: 'QUEUED', progress: 0 };
    tracks.prepareRetry.mockResolvedValue({
      processing: state,
      retryId: 'retry-1',
    });
    processing.enqueue.mockRejectedValue(new Error('Redis unavailable'));

    await expect(service.retry('user-1', privateTrack.id)).resolves.toEqual(
      state,
    );
    expect(processing.enqueue).toHaveBeenCalledWith(
      'user-1',
      privateTrack.id,
      'retry-1',
    );
  });

  it('returns the active state without enqueueing a duplicate retry', async () => {
    const state = { status: 'EXTRACTING_VOCALS', progress: 10 };
    tracks.prepareRetry.mockResolvedValue({ processing: state });

    await expect(service.retry('user-1', privateTrack.id)).resolves.toEqual(
      state,
    );
    expect(processing.enqueue).not.toHaveBeenCalled();
  });
});

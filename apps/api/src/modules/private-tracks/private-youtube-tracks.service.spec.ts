import { Test, type TestingModule } from '@nestjs/testing';
import { ZodValidationException } from '../../common/zod/zod-validation.pipe.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { PrivateTrackWorkflowService } from './private-track-workflow.service.js';
import { PrivateYouTubeTracksRepository } from './private-youtube-tracks.repository.js';
import { PrivateYouTubeTracksService } from './private-youtube-tracks.service.js';

const VIDEO_ID = 'aBcd1Efgh_2';
const LINK = `https://youtu.be/${VIDEO_ID}`;

describe('PrivateYouTubeTracksService', () => {
  const repository = {
    findOwnedVideo: vi.fn(),
    reserve: vi.fn(),
  };
  const membership = { hasPaidMembership: vi.fn() };
  const youtube = { getPracticeVideo: vi.fn() };
  const workflow = { queueProcessing: vi.fn() };
  let module: TestingModule;
  let service: PrivateYouTubeTracksService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrivateYouTubeTracksService,
        { provide: PrivateYouTubeTracksRepository, useValue: repository },
        { provide: SubscriptionMembershipService, useValue: membership },
        { provide: YouTubeMusicClient, useValue: youtube },
        { provide: PrivateTrackWorkflowService, useValue: workflow },
      ],
    }).compile();
    service = module.get(PrivateYouTubeTracksService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    membership.hasPaidMembership.mockResolvedValue(true);
    youtube.getPracticeVideo.mockResolvedValue({
      title: 'Rehearsal',
      durationSeconds: 1800,
    });
    repository.reserve.mockImplementation((input) => ({
      ...input,
      artist: '',
      processingStatus: 'QUEUED',
      processingProgress: 0,
      processingRetryId: null,
      createdAt: new Date('2026-11-26T00:00:00Z'),
    }));
  });

  it('accepts a video at exactly 30 minutes using its title and no guessed artist', async () => {
    const track = await service.submit('owner', LINK);
    expect(track).toMatchObject({
      title: 'Rehearsal',
      artist: '',
      durationMs: 1_800_000,
      processing: { status: 'QUEUED', progress: 0 },
    });
    expect(youtube.getPracticeVideo).toHaveBeenCalledWith(VIDEO_ID);
    expect(workflow.queueProcessing).toHaveBeenCalledWith(
      'owner',
      track.id,
      null,
    );
  });

  it('denies a free user before fetching external data', async () => {
    membership.hasPaidMembership.mockResolvedValue(false);
    await expect(service.submit('owner', LINK)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(youtube.getPracticeVideo).not.toHaveBeenCalled();
  });

  it('refuses a playlist while accepting a watch link with tracking parameters', async () => {
    await expect(
      service.submit('owner', 'https://www.youtube.com/playlist?list=abcdef'),
    ).rejects.toBeInstanceOf(ZodValidationException);
    expect(youtube.getPracticeVideo).not.toHaveBeenCalled();
    await expect(
      service.submit(
        'owner',
        `https://www.youtube.com/watch?v=${VIDEO_ID}&list=abcdef`,
      ),
    ).resolves.toMatchObject({ title: 'Rehearsal' });
  });

  it('returns the existing entry even if the video is unavailable now', async () => {
    const original = await service.submit('owner', LINK);
    repository.findOwnedVideo.mockResolvedValue({
      ...original,
      createdAt: new Date(original.createdAt),
    });
    youtube.getPracticeVideo.mockClear();
    await expect(service.submit('owner', LINK)).resolves.toMatchObject({
      id: original.id,
    });
    expect(youtube.getPracticeVideo).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, Infinity, -2, 1800.1])(
    'rejects metadata with invalid duration %s',
    async (durationSeconds) => {
      youtube.getPracticeVideo.mockResolvedValue({
        title: 'Rehearsal',
        durationSeconds,
      });
      await expect(service.submit('owner', LINK)).rejects.toBeInstanceOf(
        ZodValidationException,
      );
    },
  );

  it('reports a transient metadata failure without saving an entry', async () => {
    youtube.getPracticeVideo.mockRejectedValue(new Error('YouTube offline'));
    await expect(service.submit('owner', LINK)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(repository.reserve).not.toHaveBeenCalled();
  });
});

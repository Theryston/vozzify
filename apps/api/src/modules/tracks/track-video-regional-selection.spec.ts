import { Test } from '@nestjs/testing';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import { TrackVideoService } from './track-video.service.js';

const recording = {
  id: 'one-life',
  title: 'One Life',
  artistNames: ['Ed Sheeran'],
  lengthMs: 232_000,
  coverUrl: null,
  primaryReleaseMbid: null,
  youtubeVideoId: null,
  externalUrls: [],
  releases: [],
};
const candidate = (videoId: string) => ({
  videoId,
  title: 'One Life',
  artists: ['Ed Sheeran'],
  durationSeconds: 232,
  kind: 'song',
  artworkUrl: null,
});

describe('Track selection after hosted search', () => {
  const youtube = { searchSongs: vi.fn(), canPlayVideo: vi.fn() };
  let service: TrackVideoService;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetAllMocks();
    youtube.searchSongs.mockResolvedValue([
      candidate('aaaaaaaaaaa'),
      candidate('bbbbbbbbbbb'),
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackVideoService,
        { provide: ENV, useValue: {} },
        { provide: YouTubeMusicClient, useValue: youtube },
      ],
    }).compile();
    service = moduleRef.get(TrackVideoService);
    close = () => moduleRef.close();
  });

  afterEach(async () => {
    await close();
  });

  it('skips a regional release and selects the next eligible result', async () => {
    youtube.canPlayVideo
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(service.findVideo(recording)).resolves.toEqual({
      video: { videoId: 'bbbbbbbbbbb', source: 'youtube_music' },
    });
    expect(youtube.canPlayVideo.mock.calls).toEqual([
      ['aaaaaaaaaaa'],
      ['bbbbbbbbbbb'],
    ]);
  });

  it('refuses to store a result when none passes the playback policy', async () => {
    youtube.canPlayVideo.mockResolvedValue(false);

    await expect(service.findVideo(recording)).rejects.toMatchObject({
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it('keeps playback lookup failures retryable', async () => {
    youtube.canPlayVideo.mockRejectedValue(new Error('YouTube timeout'));

    await expect(service.findVideo(recording)).rejects.toThrow(
      'YouTube timeout',
    );
  });
});

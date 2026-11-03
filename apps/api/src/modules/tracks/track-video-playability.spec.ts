import { Test } from '@nestjs/testing';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import type { YouTubeVideo } from '../../integrations/youtube-music/youtube-video.js';
import { TrackVideoService } from './track-video.service.js';

const unavailableId = 'uP1ywAv8rEY';
const playableId = 'zzzzzzzzzzz';
const candidate = (videoId: string): YouTubeVideo => ({
  videoId,
  title: 'One Life',
  artists: ['Ed Sheeran'],
  durationSeconds: 232,
  kind: 'song',
  artworkUrl: null,
});
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

describe('Track video playback eligibility', () => {
  const youtube = {
    searchSongs: vi.fn<() => Promise<YouTubeVideo[]>>(),
    getVideo: vi.fn<(id: string) => Promise<YouTubeVideo | undefined>>(),
    canPlayVideo: vi.fn<(id: string) => Promise<boolean>>(),
  };
  const createService = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackVideoService,
        { provide: ENV, useValue: {} },
        { provide: YouTubeMusicClient, useValue: youtube },
      ],
    }).compile();
    return { service: moduleRef.get(TrackVideoService), moduleRef };
  };

  beforeEach(() => {
    vi.resetAllMocks();
    youtube.searchSongs.mockResolvedValue([
      candidate(unavailableId),
      candidate(playableId),
    ]);
    youtube.canPlayVideo.mockImplementation(async (id) => id === playableId);
  });

  it('skips the best metadata match when it cannot play on the web', async () => {
    const { service, moduleRef } = await createService();
    try {
      await expect(service.findVideo(recording)).resolves.toMatchObject({
        video: { videoId: playableId, source: 'youtube_music' },
      });
      expect(youtube.canPlayVideo.mock.calls).toEqual([
        [unavailableId],
        [playableId],
      ]);
    } finally {
      await moduleRef.close();
    }
  });

  it('rejects an unavailable MusicBrainz link and uses the search', async () => {
    youtube.getVideo.mockResolvedValue(candidate(unavailableId));
    const { service, moduleRef } = await createService();
    try {
      await expect(
        service.findVideo({
          ...recording,
          externalUrls: [`https://youtu.be/${unavailableId}`],
        }),
      ).resolves.toMatchObject({ video: { videoId: playableId } });
    } finally {
      await moduleRef.close();
    }
  });

  it('reports VIDEO_NOT_FOUND when every matching video is unavailable', async () => {
    youtube.canPlayVideo.mockResolvedValue(false);
    const { service, moduleRef } = await createService();
    try {
      await expect(service.findVideo(recording)).rejects.toMatchObject({
        code: 'VIDEO_NOT_FOUND',
      });
    } finally {
      await moduleRef.close();
    }
  });

  it('keeps lookup outages retryable instead of accepting unchecked videos', async () => {
    youtube.canPlayVideo.mockRejectedValue(new Error('YouTube timeout'));
    const { service, moduleRef } = await createService();
    try {
      await expect(service.findVideo(recording)).rejects.toThrow(
        'YouTube timeout',
      );
    } finally {
      await moduleRef.close();
    }
  });
});

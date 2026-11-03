import { Test } from '@nestjs/testing';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import type {
  YouTubePlaybackAvailability,
  YouTubeVideo,
} from '../../integrations/youtube-music/youtube-video.js';
import { TrackVideoService } from './track-video.service.js';

const linkedId = 'bbbbbbbbbbb';
const searchId = 'aaaaaaaaaaa';
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
    getPlaybackAvailability:
      vi.fn<(id: string) => Promise<YouTubePlaybackAvailability>>(),
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
      candidate(searchId),
      candidate('zzzzzzzzzzz'),
    ]);
    youtube.getPlaybackAvailability.mockImplementation(async (id) =>
      id === searchId ? 'both' : null,
    );
  });

  it('validates the best hosted search match before selecting it', async () => {
    const { service, moduleRef } = await createService();
    try {
      await expect(service.findVideo(recording)).resolves.toMatchObject({
        video: { videoId: searchId, source: 'youtube_music' },
      });
      expect(youtube.getPlaybackAvailability.mock.calls).toEqual([[searchId]]);
    } finally {
      await moduleRef.close();
    }
  });

  it('rejects an unavailable MusicBrainz link and uses the search', async () => {
    youtube.getVideo.mockResolvedValue(candidate(linkedId));
    const { service, moduleRef } = await createService();
    try {
      await expect(
        service.findVideo({
          ...recording,
          externalUrls: [`https://youtu.be/${linkedId}`],
        }),
      ).resolves.toMatchObject({
        video: { videoId: searchId, source: 'youtube_music' },
      });
      expect(youtube.getPlaybackAvailability.mock.calls).toEqual([
        [linkedId],
        [searchId],
      ]);
    } finally {
      await moduleRef.close();
    }
  });

  it('reports VIDEO_NOT_FOUND when the hosted results do not match', async () => {
    youtube.searchSongs.mockResolvedValue([
      { ...candidate(searchId), artists: ['Another artist'] },
    ]);
    const { service, moduleRef } = await createService();
    try {
      await expect(service.findVideo(recording)).rejects.toMatchObject({
        code: 'VIDEO_NOT_FOUND',
      });
      expect(youtube.getPlaybackAvailability).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });

  it('keeps direct playback check outages retryable for MusicBrainz links', async () => {
    youtube.getVideo.mockResolvedValue(candidate(linkedId));
    youtube.getPlaybackAvailability.mockRejectedValue(
      new Error('YouTube timeout'),
    );
    const { service, moduleRef } = await createService();
    try {
      await expect(
        service.findVideo({
          ...recording,
          externalUrls: [`https://youtu.be/${linkedId}`],
        }),
      ).rejects.toThrow('YouTube timeout');
      expect(youtube.searchSongs).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });
});

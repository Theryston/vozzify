import { Test, type TestingModule } from '@nestjs/testing';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import type { YouTubeVideo } from '../../integrations/youtube-music/youtube-video.js';
import { TrackProcessingFailure } from './track-processing-failure.js';
import type { PipelineTrack } from './track-repository.helpers.js';
import { TrackVideoService } from './track-video.service.js';

// "Bohemian Rhapsody" by Queen, 5:54, with the YouTube videos the cases use.
const LINK_ID = 'aaaaaaaaaaa';
const SEARCH_ID = 'bbbbbbbbbbb';

const track = (overrides: Partial<PipelineTrack> = {}): PipelineTrack => ({
  id: 'track-1',
  title: 'Bohemian Rhapsody',
  lengthMs: 354_000,
  coverUrl: null,
  primaryReleaseMbid: null,
  youtubeVideoId: null,
  artistNames: ['Queen'],
  externalUrls: [],
  releases: [],
  ...overrides,
});

const video = (overrides: Partial<YouTubeVideo> = {}): YouTubeVideo => ({
  videoId: SEARCH_ID,
  title: 'Queen - Bohemian Rhapsody (Official Video)',
  artists: ['Queen'],
  durationSeconds: 354,
  kind: 'song',
  artworkUrl: null,
  ...overrides,
});

const linkOf = (id: string) => `https://music.youtube.com/watch?v=${id}`;

const youtube = {
  searchSongs: vi.fn<(query: string) => Promise<YouTubeVideo[]>>(),
  getVideo: vi.fn<(videoId: string) => Promise<YouTubeVideo | undefined>>(),
  canPlayVideo: vi.fn<(videoId: string) => Promise<boolean>>(),
};

describe('TrackVideoService', () => {
  let service: TrackVideoService;
  let moduleRef: TestingModule;

  const configure = async (maxDurationSeconds?: number) => {
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackVideoService,
        {
          provide: ENV,
          useValue: { PROCESSING_MAX_DURATION_SECONDS: maxDurationSeconds },
        },
        { provide: YouTubeMusicClient, useValue: youtube },
      ],
    }).compile();
    service = moduleRef.get(TrackVideoService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    youtube.searchSongs.mockResolvedValue([]);
    youtube.getVideo.mockResolvedValue(undefined);
    youtube.canPlayVideo.mockResolvedValue(true);
    await configure();
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  describe('the Recording links to a YouTube video that matches', () => {
    beforeEach(() => {
      youtube.getVideo.mockResolvedValue(video({ videoId: LINK_ID }));
    });

    it('chooses the linked video over the search result', async () => {
      youtube.searchSongs.mockResolvedValue([video({ videoId: SEARCH_ID })]);

      const finding = await service.findVideo(
        track({ externalUrls: ['https://example.com/x', linkOf(LINK_ID)] }),
      );

      expect(finding.video).toEqual({
        videoId: LINK_ID,
        source: 'musicbrainz',
      });
    });

    it('does not search for artwork once the linked video is playable', async () => {
      youtube.searchSongs.mockResolvedValue([
        video({ videoId: SEARCH_ID, artworkUrl: 'https://img.test/a.jpg' }),
      ]);

      const finding = await service.findVideo(
        track({ externalUrls: [linkOf(LINK_ID)] }),
      );

      expect(youtube.searchSongs).not.toHaveBeenCalled();
      expect(finding).toEqual({
        video: { videoId: LINK_ID, source: 'musicbrainz' },
      });
    });

    it('chooses the link without depending on search availability', async () => {
      youtube.searchSongs.mockRejectedValue(new Error('YouTube is down'));

      const finding = await service.findVideo(
        track({ externalUrls: [linkOf(LINK_ID)] }),
      );

      expect(finding).toEqual({
        video: { videoId: LINK_ID, source: 'musicbrainz' },
      });
      expect(youtube.searchSongs).not.toHaveBeenCalled();
    });
  });

  describe('the link does not match', () => {
    it('falls back to the best search result', async () => {
      youtube.getVideo.mockResolvedValue(
        video({ videoId: LINK_ID, artists: ['Adele'] }),
      );
      youtube.searchSongs.mockResolvedValue([video({ videoId: SEARCH_ID })]);

      const finding = await service.findVideo(
        track({ externalUrls: [linkOf(LINK_ID)] }),
      );

      expect(finding.video).toEqual({
        videoId: SEARCH_ID,
        source: 'youtube_music',
      });
      expect(youtube.searchSongs).toHaveBeenCalledWith(
        'Queen Bohemian Rhapsody',
      );
    });

    it('falls back to the search when the link cannot be read', async () => {
      youtube.getVideo.mockRejectedValue(new Error('video unavailable'));
      youtube.searchSongs.mockResolvedValue([video({ videoId: SEARCH_ID })]);

      const finding = await service.findVideo(
        track({ externalUrls: [linkOf(LINK_ID)] }),
      );

      expect(finding.video.source).toBe('youtube_music');
    });

    it('reads each linked video once even when several links name it', async () => {
      youtube.getVideo.mockResolvedValue(undefined);
      youtube.searchSongs.mockResolvedValue([video()]);

      await service.findVideo(
        track({
          externalUrls: [linkOf(LINK_ID), `https://youtu.be/${LINK_ID}`],
        }),
      );

      expect(youtube.getVideo).toHaveBeenCalledTimes(1);
    });

    it('fails with the search error when no link matches either', async () => {
      youtube.searchSongs.mockRejectedValue(new Error('YouTube is down'));

      await expect(service.findVideo(track())).rejects.toThrow(
        'YouTube is down',
      );
    });
  });

  it('reports no video when no candidate matches', async () => {
    youtube.searchSongs.mockResolvedValue([
      video({ artists: ['Adele'], title: 'Hello' }),
    ]);

    await expect(service.findVideo(track())).rejects.toMatchObject({
      code: 'VIDEO_NOT_FOUND',
    });
    await expect(service.findVideo(track())).rejects.toBeInstanceOf(
      TrackProcessingFailure,
    );
  });

  describe('the length limit', () => {
    it('refuses a Recording over the limit before any search', async () => {
      await expect(
        service.findVideo(track({ lengthMs: 1_000_000 })),
      ).rejects.toMatchObject({ code: 'TOO_LONG' });

      expect(youtube.searchSongs).not.toHaveBeenCalled();
      expect(youtube.getVideo).not.toHaveBeenCalled();
    });

    it('accepts a Recording of exactly the limit', async () => {
      youtube.searchSongs.mockResolvedValue([
        video({ durationSeconds: 900, title: 'Queen - Bohemian Rhapsody' }),
      ]);

      await expect(
        service.findVideo(track({ lengthMs: 900_000 })),
      ).resolves.toMatchObject({ video: { source: 'youtube_music' } });
    });

    it('refuses a chosen video over the limit when the Recording has no length', async () => {
      youtube.searchSongs.mockResolvedValue([video({ durationSeconds: 1000 })]);

      await expect(
        service.findVideo(track({ lengthMs: null })),
      ).rejects.toMatchObject({ code: 'TOO_LONG' });
    });

    it('accepts a chosen video of unknown length when the Recording has none', async () => {
      youtube.searchSongs.mockResolvedValue([video({ durationSeconds: null })]);

      await expect(
        service.findVideo(track({ lengthMs: null })),
      ).resolves.toMatchObject({ video: { source: 'youtube_music' } });
    });

    it('honours PROCESSING_MAX_DURATION_SECONDS from the environment', async () => {
      await moduleRef.close();
      await configure(300);

      await expect(service.findVideo(track())).rejects.toMatchObject({
        code: 'TOO_LONG',
      });
    });
  });
});

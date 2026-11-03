import { Test } from '@nestjs/testing';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import type { YouTubePlaybackAvailability } from '../../integrations/youtube-music/youtube-video.js';
import { TrackVideoService } from './track-video.service.js';

type Availability = YouTubePlaybackAvailability;
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
const video = (videoId: string) => ({
  videoId,
  title: 'One Life',
  artists: ['Ed Sheeran'],
  durationSeconds: 232,
  kind: 'song',
  artworkUrl: null,
});

describe('Track video country priority', () => {
  const youtube = {
    searchSongs: vi.fn(),
    getVideo: vi.fn(),
    getPlaybackAvailability: vi.fn<(id: string) => Promise<Availability>>(),
  };
  let service: TrackVideoService;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetAllMocks();
    youtube.searchSongs.mockResolvedValue([]);
    youtube.getVideo.mockImplementation(async (id: string) => video(id));
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

  it.each([
    { available: ['US', 'BR', 'both'], selected: 'ccccccccccc' },
    { available: ['US', 'BR', null], selected: 'bbbbbbbbbbb' },
    { available: ['US', null, null], selected: 'aaaaaaaaaaa' },
    { available: ['BR', 'BR', null], selected: 'aaaaaaaaaaa' },
  ] satisfies { available: Availability[]; selected: string }[])(
    'chooses $selected for $available',
    async ({ available, selected }) => {
      const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
      youtube.searchSongs.mockResolvedValue(ids.map(video));
      youtube.getPlaybackAvailability.mockImplementation(
        async (id) => available[ids.indexOf(id)] ?? null,
      );

      await expect(service.findVideo(recording)).resolves.toEqual({
        video: { videoId: selected, source: 'youtube_music' },
      });
    },
  );

  it('reports no video when neither country is available', async () => {
    youtube.searchSongs.mockResolvedValue([video('aaaaaaaaaaa')]);
    youtube.getPlaybackAvailability.mockResolvedValue(null);

    await expect(service.findVideo(recording)).rejects.toMatchObject({
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it.each([
    {
      linked: 'US',
      searched: 'BR',
      id: 'bbbbbbbbbbb',
      source: 'youtube_music',
    },
    {
      linked: 'BR',
      searched: 'both',
      id: 'bbbbbbbbbbb',
      source: 'youtube_music',
    },
    { linked: 'BR', searched: 'US', id: 'aaaaaaaaaaa', source: 'musicbrainz' },
    { linked: 'BR', searched: 'BR', id: 'aaaaaaaaaaa', source: 'musicbrainz' },
    { linked: 'US', searched: null, id: 'aaaaaaaaaaa', source: 'musicbrainz' },
  ] satisfies {
    linked: Availability;
    searched: Availability;
    id: string;
    source: string;
  }[])(
    'compares linked $linked with searched $searched',
    async ({ linked, searched, id, source }) => {
      youtube.searchSongs.mockResolvedValue([video('bbbbbbbbbbb')]);
      youtube.getPlaybackAvailability.mockImplementation(async (candidateId) =>
        candidateId === 'aaaaaaaaaaa' ? linked : searched,
      );

      await expect(
        service.findVideo({
          ...recording,
          externalUrls: ['https://youtu.be/aaaaaaaaaaa'],
        }),
      ).resolves.toEqual({ video: { videoId: id, source } });
    },
  );

  it('compares all linked candidates before accepting a regional fallback', async () => {
    youtube.getPlaybackAvailability.mockImplementation(async (id) =>
      id === 'aaaaaaaaaaa' ? 'US' : 'BR',
    );

    await expect(
      service.findVideo({
        ...recording,
        externalUrls: [
          'https://youtu.be/aaaaaaaaaaa',
          'https://youtu.be/bbbbbbbbbbb',
        ],
      }),
    ).resolves.toEqual({
      video: { videoId: 'bbbbbbbbbbb', source: 'musicbrainz' },
    });
  });

  it('does not depend on search when a link is available in both countries', async () => {
    youtube.getPlaybackAvailability.mockResolvedValue('both');
    youtube.searchSongs.mockRejectedValue(new Error('search down'));

    await expect(
      service.findVideo({
        ...recording,
        externalUrls: ['https://youtu.be/aaaaaaaaaaa'],
      }),
    ).resolves.toMatchObject({ video: { source: 'musicbrainz' } });
    expect(youtube.searchSongs).not.toHaveBeenCalled();
  });
});

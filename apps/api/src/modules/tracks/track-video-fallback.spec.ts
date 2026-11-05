import { Test, type TestingModule } from '@nestjs/testing';
import { Innertube } from 'youtubei.js';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import { TrackVideoService } from './track-video.service.js';

vi.mock('youtubei.js', () => ({ Innertube: { create: vi.fn() } }));

const recording = {
  id: 'penguins',
  title: 'Penguins',
  artistNames: ['Ed Sheeran'],
  lengthMs: 248_867,
  coverUrl: null,
  primaryReleaseMbid: null,
  youtubeVideoId: null,
  externalUrls: [],
  releases: [],
};
const officialVideo = {
  id: 'CnVD9KLAOrA',
  title: 'Penguins',
  authors: [{ name: 'Ed Sheeran' }],
  duration: { seconds: 250 },
  item_type: 'video',
  thumbnails: [],
};
const song = {
  ...officialVideo,
  id: 'cIjiF4kWtFo',
  artists: [{ name: 'Ed Sheeran' }],
  item_type: 'song',
};

describe('Track video fallback through the YouTube Music SDK', () => {
  const search = vi.fn();
  const getBasicInfo = vi.fn();
  let moduleRef: TestingModule;
  let service: TrackVideoService;

  beforeEach(async () => {
    vi.resetAllMocks();
    search.mockImplementation(async (_query, options) =>
      options.type === 'song'
        ? { songs: { contents: [] } }
        : { videos: { contents: [officialVideo] } },
    );
    getBasicInfo.mockResolvedValue({
      playability_status: { status: 'OK', embeddable: true },
      page: [{ microformat: { available_countries: ['BR', 'US'] } }],
    });
    vi.mocked(Innertube.create).mockResolvedValue({
      music: { search },
      getBasicInfo,
    } as unknown as Innertube);
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackVideoService,
        YouTubeMusicClient,
        { provide: ENV, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(TrackVideoService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it.each([
    { reason: 'empty songs', songs: [] },
    { reason: 'unmatched songs', songs: [{ ...song, title: 'Galway Girl' }] },
    { reason: 'unavailable songs', songs: [song] },
  ])('finds Penguins after $reason', async ({ songs }) => {
    search.mockResolvedValueOnce({ songs: { contents: songs } });
    getBasicInfo.mockImplementation(async (id) => ({
      playability_status: {
        status: id === song.id ? 'UNPLAYABLE' : 'OK',
        embeddable: id !== song.id,
      },
      page: [{ microformat: { available_countries: ['BR', 'US'] } }],
    }));

    await expect(service.findVideo(recording)).resolves.toEqual({
      video: { videoId: officialVideo.id, source: 'youtube_music' },
    });
    expect(search.mock.calls).toEqual([
      ['Ed Sheeran Penguins', { type: 'song' }],
      ['Ed Sheeran Penguins', { type: 'video' }],
    ]);
    expect(getBasicInfo).toHaveBeenCalledWith(officialVideo.id, {
      client: 'WEB',
    });
    expect(Innertube.create).toHaveBeenCalledOnce();
  });

  it('keeps a playable song without searching videos', async () => {
    search.mockResolvedValueOnce({ songs: { contents: [song] } });

    await expect(service.findVideo(recording)).resolves.toMatchObject({
      video: { videoId: song.id },
    });
    expect(search).toHaveBeenCalledExactlyOnceWith('Ed Sheeran Penguins', {
      type: 'song',
    });
  });

  it.each([
    {
      reason: 'wrong artist',
      video: { ...officialVideo, authors: [{ name: 'Cover singer' }] },
    },
    {
      reason: 'wrong title',
      video: { ...officialVideo, title: 'Penguins (Live)' },
    },
    {
      reason: 'wrong duration',
      video: { ...officialVideo, duration: { seconds: 300 } },
    },
    {
      reason: 'missing artist',
      video: { ...officialVideo, authors: undefined },
    },
  ])('rejects videos with $reason', async ({ video }) => {
    search.mockResolvedValueOnce({ songs: { contents: [] } });
    search.mockResolvedValueOnce({ videos: { contents: [video] } });

    await expect(service.findVideo(recording)).rejects.toMatchObject({
      code: 'VIDEO_NOT_FOUND',
    });
    expect(getBasicInfo).not.toHaveBeenCalled();
  });

  it.each([{}, { videos: {} }, { videos: { contents: [] } }])(
    'reports no match when the video search is empty: %j',
    async (response) => {
      search.mockResolvedValueOnce({ songs: { contents: [] } });
      search.mockResolvedValueOnce(response);

      await expect(service.findVideo(recording)).rejects.toMatchObject({
        code: 'VIDEO_NOT_FOUND',
      });
    },
  );

  it('rejects a matching video that cannot be embedded', async () => {
    getBasicInfo.mockResolvedValue({
      playability_status: { status: 'OK', embeddable: false },
    });

    await expect(service.findVideo(recording)).rejects.toMatchObject({
      code: 'VIDEO_NOT_FOUND',
    });
    expect(getBasicInfo).toHaveBeenCalledWith(officialVideo.id, {
      client: 'WEB',
    });
  });

  it('keeps video search outages retryable', async () => {
    search.mockResolvedValueOnce({ songs: { contents: [] } });
    search.mockRejectedValueOnce(new Error('Video search timeout'));

    await expect(service.findVideo(recording)).rejects.toThrow(
      'Video search timeout',
    );
  });

  it('propagates song search outages without treating them as no match', async () => {
    search.mockRejectedValueOnce(new Error('Song search timeout'));

    await expect(service.findVideo(recording)).rejects.toThrow(
      'Song search timeout',
    );
    expect(search).toHaveBeenCalledOnce();
  });
});

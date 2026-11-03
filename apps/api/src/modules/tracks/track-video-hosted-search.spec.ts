import { Test } from '@nestjs/testing';
import { Innertube } from 'youtubei.js';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import { TrackVideoService } from './track-video.service.js';

vi.mock('youtubei.js', () => ({ Innertube: { create: vi.fn() } }));

describe('Track selection through the hosted search service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it.each([
    { externalUrls: [] },
    { externalUrls: ['https://youtu.be/bbbbbbbbbbb'] },
  ])(
    'validates the hosted result even when linked metadata fails, with links $externalUrls',
    async ({ externalUrls }) => {
      const create = vi.mocked(Innertube.create);
      const getInfo = vi
        .fn()
        .mockRejectedValue(
          new TypeError('Failed to parse URL from [object Request]'),
        );
      const getBasicInfo = vi.fn().mockResolvedValue({
        playability_status: { status: 'OK', embeddable: true },
        page: [{ microformat: { available_countries: ['BR', 'US'] } }],
      });
      create.mockResolvedValue({
        music: { getInfo },
        getBasicInfo,
      } as unknown as Innertube);
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json([
          {
            videoId: 'aaaaaaaaaaa',
            title: 'Shape of You',
            artists: [{ name: 'Ed Sheeran' }],
            duration_seconds: 234,
            resultType: 'song',
            thumbnails: [],
          },
        ]),
      );
      vi.stubGlobal('fetch', request);
      const moduleRef = await Test.createTestingModule({
        providers: [
          TrackVideoService,
          YouTubeMusicClient,
          { provide: ENV, useValue: {} },
        ],
      }).compile();
      try {
        await expect(
          moduleRef.get(TrackVideoService).findVideo({
            id: 'shape-of-you',
            title: 'Shape of You',
            artistNames: ['Ed Sheeran'],
            lengthMs: 234_000,
            coverUrl: null,
            primaryReleaseMbid: null,
            youtubeVideoId: null,
            externalUrls,
            releases: [],
          }),
        ).resolves.toEqual({
          video: { videoId: 'aaaaaaaaaaa', source: 'youtube_music' },
        });
        expect(request).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledOnce();
        expect(getInfo).toHaveBeenCalledTimes(externalUrls.length);
        expect(getBasicInfo).toHaveBeenCalledWith('aaaaaaaaaaa', {
          client: 'WEB',
        });
      } finally {
        await moduleRef.close();
      }
    },
  );
});

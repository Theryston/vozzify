import { Test } from '@nestjs/testing';
import { Response as HttpResponse, MockAgent, ProxyAgent } from 'undici';
import { Innertube, Player } from 'youtubei.js';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

const videoId = 'xTvyyoF_LZY';
const song = {
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId },
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              {
                text: 'Shape of You',
                navigationEndpoint: {
                  watchEndpoint: {
                    videoId,
                    watchEndpointMusicSupportedConfigs: {
                      watchEndpointMusicConfig: {
                        musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              {
                text: 'Ed Sheeran',
                navigationEndpoint: {
                  browseEndpoint: { browseId: 'UC-fixture-artist' },
                },
              },
              { text: ' • ' },
              { text: '3:54' },
            ],
          },
        },
      },
    ],
  },
};

const searchResponse = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            selected: true,
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicShelfRenderer: {
                      title: { runs: [{ text: 'Songs' }] },
                      contents: [song],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

describe('YouTube Music search through the configured proxy', () => {
  it('sends the real SDK search POST with Brazilian context and parses its songs', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const requests: unknown[] = [];
    const dispatch = vi
      .spyOn(ProxyAgent.prototype, 'dispatch')
      .mockImplementation((options, handler) =>
        agent.dispatch(options, handler),
      );
    agent
      .get('https://www.youtube.com')
      .intercept({
        path: '/youtubei/v1/search?prettyPrint=false&alt=json',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      .reply(async (options) => {
        requests.push(JSON.parse(await new HttpResponse(options.body).text()));
        return { statusCode: 200, data: searchResponse };
      });
    const createSession = Innertube.create.bind(Innertube);
    vi.spyOn(Player, 'create').mockResolvedValue(new Player('fixture', 20754));
    vi.spyOn(Innertube, 'create').mockImplementation((options) =>
      createSession({
        ...options,
        generate_session_locally: true,
        retrieve_innertube_config: false,
      }),
    );
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Search must use the configured proxy'),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        YouTubeMusicClient,
        {
          provide: ENV,
          useValue: {
            PROXY_HOST: 'proxy.test',
            PROXY_PORT: 8080,
            PROXY_USERNAME: 'fixture',
            PROXY_PASSWORD: 'secret',
          },
        },
      ],
    }).compile();
    try {
      const client = moduleRef.get(YouTubeMusicClient);

      await expect(
        client.searchSongs('Ed Sheeran Shape of You'),
      ).resolves.toEqual([
        {
          videoId,
          title: 'Shape of You',
          artists: ['Ed Sheeran'],
          durationSeconds: 234,
          kind: 'song',
          artworkUrl: null,
        },
      ]);
      expect(requests).toEqual([
        expect.objectContaining({
          query: 'Ed Sheeran Shape of You',
          params: 'EgWKAQIIAQ%3D%3D',
          isAudioOnly: true,
          context: expect.objectContaining({
            client: expect.objectContaining({
              clientName: 'WEB_REMIX',
              gl: 'BR',
            }),
          }),
        }),
      ]);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      agent.assertNoPendingInterceptors();
    } finally {
      await moduleRef.close();
      vi.restoreAllMocks();
      await agent.close();
    }
  });
});

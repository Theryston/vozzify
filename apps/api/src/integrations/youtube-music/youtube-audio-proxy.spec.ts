import { Response as HttpResponse, MockAgent, ProxyAgent } from 'undici';
import { Innertube, Platform, Player } from 'youtubei.js';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

describe('Real SDK audio transport through the proxy', () => {
  it('uses the proxy for both player metadata and audio bytes without a PO token', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const dispatch = vi
      .spyOn(ProxyAgent.prototype, 'dispatch')
      .mockImplementation((options, handler) =>
        agent.dispatch(options, handler),
      );
    const evaluator = Platform.shim.eval;
    let playerRequest: unknown;
    agent
      .get('https://www.youtube.com')
      .intercept({
        path: '/youtubei/v1/player?prettyPrint=false&alt=json',
        method: 'POST',
      })
      .reply(async (options) => {
        playerRequest = JSON.parse(await new HttpResponse(options.body).text());
        const { context } = z
          .object({
            context: z.object({ client: z.object({ clientName: z.string() }) }),
          })
          .parse(playerRequest);
        return {
          statusCode: 200,
          data: {
            playabilityStatus: { status: 'OK', playableInEmbed: true },
            videoDetails: {
              videoId: 'aaaaaaaaaaa',
              title: 'Song',
              lengthSeconds: '1',
            },
            streamingData: {
              adaptiveFormats: [
                {
                  itag: 140,
                  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                  bitrate: 128000,
                  audioQuality: 'AUDIO_QUALITY_MEDIUM',
                  audioSampleRate: '44100',
                  contentLength: '4',
                  approxDurationMs: '1000',
                  url: `https://media.test/audio?source=youtube&client=${context.client.clientName}`,
                },
              ],
            },
          },
        };
      });
    agent
      .get('https://media.test')
      .intercept({
        path: (path) => {
          const url = new URL(path, 'https://media.test');
          return (
            url.pathname === '/audio' &&
            url.searchParams.get('source') === 'youtube' &&
            url.searchParams.has('cpn') &&
            url.searchParams.get('range') === '0-10485760'
          );
        },
        method: 'GET',
      })
      .reply((options) => ({
        statusCode: options.path.includes('client=VISIONOS') ? 200 : 403,
        data: Buffer.from([1, 2, 3, 4]),
      }));
    const createSession = Innertube.create.bind(Innertube);
    vi.spyOn(Player, 'create').mockResolvedValue(new Player('fixture', 20754));
    vi.spyOn(Innertube, 'create').mockImplementation((options) =>
      createSession({
        ...options,
        generate_session_locally: true,
        retrieve_innertube_config: false,
      }),
    );
    const client = new YouTubeMusicClient({
      PROXY_HOST: 'proxy.test',
      PROXY_PORT: 8080,
      PROXY_USERNAME: 'fixture',
      PROXY_PASSWORD: 'secret',
    } as Env);
    try {
      const audio = await client.downloadAudio(
        'aaaaaaaaaaa',
        new AbortController().signal,
      );
      expect(new Uint8Array(await new Response(audio).arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );
      expect(playerRequest).toMatchObject({
        videoId: 'aaaaaaaaaaa',
        context: { client: { clientName: 'VISIONOS', gl: 'BR' } },
      });
      expect(playerRequest).not.toHaveProperty('serviceIntegrityDimensions');
      expect(dispatch).toHaveBeenCalledTimes(2);
      agent.assertNoPendingInterceptors();
    } finally {
      Platform.shim.eval = evaluator;
      vi.restoreAllMocks();
      await agent.close();
    }
  });
});

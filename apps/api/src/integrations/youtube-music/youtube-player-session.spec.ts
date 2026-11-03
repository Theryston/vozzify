import { Test } from '@nestjs/testing';
import { Innertube, Player } from 'youtubei.js';
import { z } from 'zod';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

const signatureTimestamp = 20754;
const playerRequestSchema = z.object({
  context: z.object({ client: z.object({ clientName: z.string() }) }),
  playbackContext: z.object({
    contentPlaybackContext: z.object({
      signatureTimestamp: z.number().optional(),
    }),
  }),
});

describe('YouTube player session', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supplies the player timestamp before deciding that a WEB video is unavailable', async () => {
    const requests: unknown[] = [];
    const fetchPlayer: typeof fetch = async (_input, init) => {
      const request = playerRequestSchema.parse(JSON.parse(String(init?.body)));
      requests.push(request);
      const timestamp =
        request.playbackContext.contentPlaybackContext.signatureTimestamp;
      return Response.json({
        playabilityStatus: {
          status: timestamp === signatureTimestamp ? 'OK' : 'UNPLAYABLE',
          playableInEmbed: true,
        },
      });
    };
    const createSession = Innertube.create.bind(Innertube);
    // Keep the real SDK request construction; replace only external I/O.
    vi.spyOn(Player, 'create').mockResolvedValue(
      new Player('fixture-player', signatureTimestamp),
    );
    vi.spyOn(Innertube, 'create').mockImplementation((options) =>
      createSession({
        ...options,
        generate_session_locally: true,
        retrieve_innertube_config: false,
        fetch: fetchPlayer,
      }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [YouTubeMusicClient, { provide: ENV, useValue: {} }],
    }).compile();
    try {
      const client = moduleRef.get(YouTubeMusicClient);
      await expect(client.canPlayVideo('xTvyyoF_LZY')).resolves.toBe(true);
      expect(requests).toEqual([
        {
          context: { client: { clientName: 'WEB' } },
          playbackContext: {
            contentPlaybackContext: { signatureTimestamp },
          },
        },
      ]);
    } finally {
      await moduleRef.close();
    }
  });
});

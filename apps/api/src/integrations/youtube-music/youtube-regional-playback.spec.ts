import { Test } from '@nestjs/testing';
import { Utils } from 'youtubei.js';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

const sdk = vi.hoisted(() => ({ create: vi.fn(), getBasicInfo: vi.fn() }));
vi.mock('youtubei.js', async (original) => ({
  ...(await original<typeof import('youtubei.js')>()),
  Innertube: { create: sdk.create },
}));

describe('YouTube availability in the supported playback countries', () => {
  let client: YouTubeMusicClient;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetAllMocks();
    sdk.create.mockResolvedValue({ getBasicInfo: sdk.getBasicInfo });
    const moduleRef = await Test.createTestingModule({
      providers: [YouTubeMusicClient, { provide: ENV, useValue: {} }],
    }).compile();
    client = moduleRef.get(YouTubeMusicClient);
    close = () => moduleRef.close();
  });

  afterEach(async () => {
    await close();
  });

  it.each([
    { countries: ['US'], playable: false },
    { countries: ['BR'], playable: false },
    { countries: [], playable: false },
    { countries: ['BR', 'US'], playable: true },
    { countries: ['DE', 'US', 'BR'], playable: true },
  ])(
    'requires Brazil and the USA: $countries',
    async ({ countries, playable }) => {
      sdk.getBasicInfo.mockResolvedValue({
        playability_status: { status: 'OK', embeddable: true },
        page: [{ microformat: { available_countries: countries } }],
      });

      await expect(client.canPlayVideo('aaaaaaaaaaa')).resolves.toBe(playable);
    },
  );

  it.each([[], [{}], [{ microformat: {} }]])(
    'keeps missing regional metadata retryable: %j',
    async (...page) => {
      sdk.getBasicInfo.mockResolvedValue({
        playability_status: { status: 'OK', embeddable: true },
        page,
      });

      await expect(client.canPlayVideo('aaaaaaaaaaa')).rejects.toThrow(
        'YouTube did not return video availability countries',
      );
    },
  );

  it('does not misclassify a bot challenge as an unavailable song', async () => {
    sdk.getBasicInfo.mockResolvedValue({
      playability_status: {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm you’re not a bot',
      },
    });

    await expect(client.canPlayVideo('aaaaaaaaaaa')).rejects.toThrow(
      'bot verification',
    );
  });

  it('recognizes bot challenges thrown by the SDK', async () => {
    sdk.getBasicInfo.mockRejectedValue(
      new Utils.InnertubeError('Player request failed', {
        status: 'ERROR',
        reason: "Sign in to confirm you're not a bot",
      }),
    );

    await expect(client.canPlayVideo('aaaaaaaaaaa')).rejects.toThrow(
      'bot verification',
    );
  });
});

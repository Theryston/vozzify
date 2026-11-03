import { Test } from '@nestjs/testing';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

const sdk = vi.hoisted(() => ({ create: vi.fn(), getBasicInfo: vi.fn() }));
vi.mock('youtubei.js', async (original) => ({
  ...(await original<typeof import('youtubei.js')>()),
  Innertube: { create: sdk.create },
}));

describe('YouTube country preference', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    { countries: ['BR', 'US'], expected: 'both' },
    { countries: ['US', 'DE', 'BR'], expected: 'both' },
    { countries: ['BR', 'DE'], expected: 'BR' },
    { countries: ['US'], expected: 'US' },
    { countries: ['DE'], expected: null },
    { countries: [], expected: null },
  ])('classifies $countries as $expected', async ({ countries, expected }) => {
    sdk.getBasicInfo.mockResolvedValue({
      playability_status: { status: 'OK', embeddable: true },
      page: [{ microformat: { available_countries: countries } }],
    });
    sdk.create.mockResolvedValue({ getBasicInfo: sdk.getBasicInfo });
    const moduleRef = await Test.createTestingModule({
      providers: [YouTubeMusicClient, { provide: ENV, useValue: {} }],
    }).compile();
    try {
      await expect(
        moduleRef
          .get(YouTubeMusicClient)
          .getPlaybackAvailability('aaaaaaaaaaa'),
      ).resolves.toBe(expected);
      expect(sdk.getBasicInfo).toHaveBeenCalledOnce();
    } finally {
      await moduleRef.close();
    }
  });
});

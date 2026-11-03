import { Test } from '@nestjs/testing';
import { Utils } from 'youtubei.js';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

const sdkMock = vi.hoisted(() => ({ create: vi.fn(), getBasicInfo: vi.fn() }));

vi.mock('youtubei.js', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('youtubei.js')>();
  return { ...sdk, Innertube: { create: sdkMock.create } };
});

describe('YouTube browser playability', () => {
  const { getBasicInfo } = sdkMock;
  let client: YouTubeMusicClient;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [YouTubeMusicClient, { provide: ENV, useValue: {} }],
    }).compile();
    client = moduleRef.get(YouTubeMusicClient);
    close = () => moduleRef.close();
    sdkMock.create.mockResolvedValue({ getBasicInfo });
  });

  afterEach(async () => {
    await close();
  });

  it('checks the web client instead of trusting YouTube Music metadata', async () => {
    getBasicInfo.mockResolvedValue({
      playability_status: { status: 'OK', embeddable: true },
      page: [{ microformat: { available_countries: ['BR', 'US'] } }],
    });

    await expect(client.getPlaybackAvailability('uP1ywAv8rEY')).resolves.toBe(
      'both',
    );
    expect(getBasicInfo).toHaveBeenCalledWith('uP1ywAv8rEY', {
      client: 'WEB',
    });
  });

  it.each(['UNPLAYABLE', 'LOGIN_REQUIRED', 'ERROR', 'LIVE_STREAM_OFFLINE'])(
    'rejects %s even when metadata and embed permission remain available',
    async (status) => {
      getBasicInfo.mockResolvedValue({
        basic_info: { title: 'One Life' },
        playability_status: { status, embeddable: true },
      });

      await expect(client.getPlaybackAvailability('uP1ywAv8rEY')).resolves.toBe(
        null,
      );
    },
  );

  it.each([
    { playability_status: { status: 'OK', embeddable: false } },
    { playability_status: { embeddable: true } },
    {},
  ])(
    'rejects missing playback confirmation or embed permission: %j',
    async (info) => {
      getBasicInfo.mockResolvedValue(info);

      await expect(client.getPlaybackAvailability('uP1ywAv8rEY')).resolves.toBe(
        null,
      );
    },
  );

  it('recognizes unavailable videos that the SDK throws instead of returning', async () => {
    getBasicInfo.mockRejectedValue(
      new Utils.InnertubeError('This video is unavailable', {
        status: 'ERROR',
      }),
    );

    await expect(client.getPlaybackAvailability('uP1ywAv8rEY')).resolves.toBe(
      null,
    );
  });

  it.each([
    new Error('connection reset'),
    new Utils.InnertubeError('Unsupported microformat'),
    new Utils.InnertubeError('Unexpected response', 'invalid'),
    new Utils.InnertubeError('Unexpected response', null),
    new Utils.InnertubeError('Unexpected response', {}),
    new Utils.InnertubeError('Unexpected response', { status: 'UNKNOWN' }),
  ])(
    'propagates transport and parser failures for retries: %s',
    async (error) => {
      getBasicInfo.mockRejectedValue(error);

      await expect(client.getPlaybackAvailability('uP1ywAv8rEY')).rejects.toBe(
        error,
      );
    },
  );
});

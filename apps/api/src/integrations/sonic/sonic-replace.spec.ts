import { parseEnv } from '../../config/env.js';
import { SonicService } from './sonic.service.js';
import { SonicChannel, SonicChannelError } from './sonic-channel.js';

describe('SonicService.replaceTrack', () => {
  afterEach(() => vi.restoreAllMocks());

  it('flushes the previous document before pushing its replacement', async () => {
    const removed = vi
      .spyOn(SonicChannel.prototype, 'removeObject')
      .mockResolvedValue(undefined);
    const pushed = vi
      .spyOn(SonicChannel.prototype, 'push')
      .mockResolvedValue(undefined);

    await new SonicService(testEnv()).replaceTrack('track-1', 'New Artist');

    expect(removed).toHaveBeenCalledWith('tracks', 'completed', 'track-1');
    expect(pushed).toHaveBeenCalledWith('track-1', 'New Artist');
    expect(removed.mock.invocationCallOrder[0]).toBeLessThan(
      pushed.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not push replacement content when the flush fails', async () => {
    const pushed = vi.spyOn(SonicChannel.prototype, 'push');
    vi.spyOn(SonicChannel.prototype, 'removeObject').mockRejectedValue(
      new SonicChannelError('transport', 'Sonic unavailable'),
    );

    await expect(
      new SonicService(testEnv()).replaceTrack('track-1', 'New Artist'),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(pushed).not.toHaveBeenCalled();
  });

  it('flushes a removed Track from the completed bucket', async () => {
    const removed = vi
      .spyOn(SonicChannel.prototype, 'removeObject')
      .mockResolvedValue(undefined);

    await new SonicService(testEnv()).removeTrack('track-1');

    expect(removed).toHaveBeenCalledWith('tracks', 'completed', 'track-1');
  });
});

const testEnv = () =>
  parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    SONIC_HOST: '127.0.0.1',
    SONIC_AUTH_PASSWORD: 'secret',
    SONIC_REQUEST_TIMEOUT_MS: '500',
  });

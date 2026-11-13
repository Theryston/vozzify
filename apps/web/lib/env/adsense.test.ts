import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const loadConfig = async () => {
  vi.resetModules();
  return (await import('./adsense')).getAdsenseConfig;
};

describe('getAdsenseConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  const setRequiredEnv = () => {
    vi.stubEnv('API_URL', 'http://localhost:3333');
    vi.stubEnv('REVALIDATE_SECRET', 'x'.repeat(32));
  };

  it('keeps serving disabled when production account values are incomplete', async () => {
    setRequiredEnv();
    vi.stubEnv('ADSENSE_ENABLED', 'true');
    vi.stubEnv('ADSENSE_CLIENT', 'ca-pub-1234567890123456');
    const getAdsenseConfig = await loadConfig();
    expect(getAdsenseConfig()).toBeUndefined();
  });

  it('returns the configured public unit only when serving is enabled', async () => {
    setRequiredEnv();
    vi.stubEnv('ADSENSE_ENABLED', 'true');
    vi.stubEnv('ADSENSE_CLIENT', 'ca-pub-1234567890123456');
    vi.stubEnv('ADSENSE_SLOT', '1234567890');
    vi.stubEnv('ADSENSE_LAYOUT_KEY', '-fb+5w+4e-db+86');
    vi.stubEnv(
      'ADSENSE_CMP_URL',
      'https://fundingchoicesmessages.google.com/cmp.js',
    );
    const getAdsenseConfig = await loadConfig();
    const config = getAdsenseConfig();
    expect(config).toEqual({
      client: 'ca-pub-1234567890123456',
      slot: '1234567890',
      layoutKey: '-fb+5w+4e-db+86',
      cmpUrl: 'https://fundingchoicesmessages.google.com/cmp.js',
    });
    expect(getAdsenseConfig()).toBe(config);
  });

  it('keeps the account values inert when serving is disabled', async () => {
    setRequiredEnv();
    vi.stubEnv('ADSENSE_ENABLED', 'false');
    vi.stubEnv('ADSENSE_CLIENT', 'ca-pub-1234567890123456');
    vi.stubEnv('ADSENSE_SLOT', '1234567890');
    vi.stubEnv('ADSENSE_LAYOUT_KEY', '-fb+5w+4e-db+86');
    vi.stubEnv(
      'ADSENSE_CMP_URL',
      'https://fundingchoicesmessages.google.com/cmp.js',
    );
    const getAdsenseConfig = await loadConfig();
    expect(getAdsenseConfig()).toBeUndefined();
  });
});

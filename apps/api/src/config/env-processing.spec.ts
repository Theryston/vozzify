import { parseEnv } from './env.js';

// The Processing and proxy settings, kept apart from env.spec.ts.
const required = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/vozzify',
  REDIS_URL: 'redis://localhost:6379',
};

const proxy = {
  PROXY_HOST: 'proxy.test',
  PROXY_PORT: '8080',
  PROXY_USERNAME: 'user',
  PROXY_PASSWORD: 'secret',
};

describe('parseEnv processing settings', () => {
  it('leaves the maximum duration unset when it is not configured', () => {
    expect(parseEnv(required).PROCESSING_MAX_DURATION_SECONDS).toBeUndefined();
  });

  it('parses the maximum duration in seconds', () => {
    expect(
      parseEnv({ ...required, PROCESSING_MAX_DURATION_SECONDS: '600' })
        .PROCESSING_MAX_DURATION_SECONDS,
    ).toBe(600);
  });

  it('refuses a maximum duration that is not a positive whole number', () => {
    expect(() =>
      parseEnv({ ...required, PROCESSING_MAX_DURATION_SECONDS: '0' }),
    ).toThrow('PROCESSING_MAX_DURATION_SECONDS');
  });

  it('has no HTTP proxy when none of its variables is set', () => {
    const env = parseEnv(required);

    expect(env.PROXY_HOST).toBeUndefined();
    expect(env.PROXY_PORT).toBeUndefined();
  });

  it('parses a complete HTTP proxy', () => {
    expect(parseEnv({ ...required, ...proxy })).toMatchObject({
      PROXY_HOST: 'proxy.test',
      PROXY_PORT: 8080,
      PROXY_USERNAME: 'user',
      PROXY_PASSWORD: 'secret',
    });
  });

  it('requires every proxy variable once any of them is set', () => {
    expect(() => parseEnv({ ...required, PROXY_HOST: 'proxy.test' })).toThrow(
      'Required when any PROXY_ variable is set',
    );
  });

  it('counts blank proxy variables as unset', () => {
    const blank = Object.fromEntries(
      Object.keys(proxy).map((key) => [key, '']),
    );

    expect(parseEnv({ ...required, ...blank }).PROXY_HOST).toBe(undefined);
  });
});

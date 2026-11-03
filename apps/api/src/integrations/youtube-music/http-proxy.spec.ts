import { createProxiedFetch, proxyOf } from './http-proxy.js';

const proxyEnv = {
  PROXY_HOST: 'proxy.test',
  PROXY_PORT: 8080,
  PROXY_USERNAME: 'fixture-user',
  PROXY_PASSWORD: 'secret',
};

describe('proxyOf', () => {
  it('is undefined when no proxy variable is set', () => {
    expect(
      proxyOf({
        PROXY_HOST: undefined,
        PROXY_PORT: undefined,
        PROXY_USERNAME: undefined,
        PROXY_PASSWORD: undefined,
      }),
    ).toBeUndefined();
  });

  it('is undefined while one of the four is missing', () => {
    expect(
      proxyOf({
        ...proxyEnv,
        PROXY_PASSWORD: undefined,
      }),
    ).toBeUndefined();
  });

  it('builds the proxy address and its basic authentication', () => {
    expect(proxyOf(proxyEnv)).toEqual({
      uri: 'http://proxy.test:8080',
      token: `Basic ${Buffer.from('fixture-user:secret').toString('base64')}`,
    });
  });
});

describe('createProxiedFetch', () => {
  it('returns a fetch function that routes through the proxy it was given', () => {
    const proxied = createProxiedFetch({
      uri: 'http://proxy.test:8080',
      token: 'Basic abc',
    });

    expect(typeof proxied).toBe('function');
    expect(proxied).not.toBe(globalThis.fetch);
  });
});

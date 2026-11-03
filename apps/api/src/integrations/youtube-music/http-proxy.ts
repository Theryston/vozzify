import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Env } from '../../config/env.js';

// YouTube Music blocks some datacenter IPs. Route requests through the
// configured HTTP proxy when all four variables are set; otherwise they
// leave directly from the server.

/** Where the HTTP proxy listens, and how to authenticate to it. */
export type HttpProxy = { uri: string; token: string };

/** The proxy the environment configures, or undefined when it does not. */
export function proxyOf(
  env: Pick<
    Env,
    'PROXY_HOST' | 'PROXY_PORT' | 'PROXY_USERNAME' | 'PROXY_PASSWORD'
  >,
): HttpProxy | undefined {
  const { PROXY_HOST, PROXY_PORT } = env;
  const { PROXY_USERNAME, PROXY_PASSWORD } = env;
  if (
    PROXY_HOST === undefined ||
    PROXY_PORT === undefined ||
    PROXY_USERNAME === undefined ||
    PROXY_PASSWORD === undefined
  ) {
    return undefined;
  }
  const credentials = `${PROXY_USERNAME}:${PROXY_PASSWORD}`;
  return {
    uri: `http://${PROXY_HOST}:${PROXY_PORT}`,
    token: `Basic ${Buffer.from(credentials).toString('base64')}`,
  };
}

/**
 * A `fetch` that sends its requests through the proxy. It is undici's fetch,
 * because the dispatcher and fetch must use the same undici version. The
 * SDK builds native Requests, which undici does not recognize as its own;
 * unpack them before crossing that boundary. Response types are declared
 * apart despite sharing the fetch API, hence the cast.
 */
export function createProxiedFetch(proxy: HttpProxy): typeof fetch {
  const dispatcher = new ProxyAgent({ uri: proxy.uri, token: proxy.token });
  const proxied = (
    input: Parameters<typeof undiciFetch>[0],
    init?: Parameters<typeof undiciFetch>[1],
  ) =>
    input instanceof Request
      ? undiciFetch(input.url, {
          method: input.method,
          headers: Object.fromEntries(input.headers),
          body: input.body,
          signal: input.signal,
          duplex: 'half',
          ...init,
          dispatcher,
        })
      : undiciFetch(input, { ...init, dispatcher });
  return proxied as unknown as typeof fetch;
}

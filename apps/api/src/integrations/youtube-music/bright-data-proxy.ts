import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Env } from '../../config/env.js';

// YouTube Music blocks some datacenter IPs. The Bright Data proxy is a way
// around that, so it is used only when its variables are all set: without
// them requests leave straight from the server, at no cost.

/** Where the Bright Data proxy listens, and how to authenticate to it. */
export type BrightDataProxy = { uri: string; token: string };

/** The proxy the environment configures, or undefined when it does not. */
export function brightDataProxyOf(
  env: Pick<
    Env,
    | 'BRIGHT_DATA_PROXY_HOST'
    | 'BRIGHT_DATA_PROXY_PORT'
    | 'BRIGHT_DATA_PROXY_USERNAME'
    | 'BRIGHT_DATA_PROXY_PASSWORD'
  >,
): BrightDataProxy | undefined {
  const { BRIGHT_DATA_PROXY_HOST, BRIGHT_DATA_PROXY_PORT } = env;
  const { BRIGHT_DATA_PROXY_USERNAME, BRIGHT_DATA_PROXY_PASSWORD } = env;
  if (
    BRIGHT_DATA_PROXY_HOST === undefined ||
    BRIGHT_DATA_PROXY_PORT === undefined ||
    BRIGHT_DATA_PROXY_USERNAME === undefined ||
    BRIGHT_DATA_PROXY_PASSWORD === undefined
  ) {
    return undefined;
  }
  const credentials = `${BRIGHT_DATA_PROXY_USERNAME}:${BRIGHT_DATA_PROXY_PASSWORD}`;
  return {
    uri: `http://${BRIGHT_DATA_PROXY_HOST}:${BRIGHT_DATA_PROXY_PORT}`,
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
export function createProxiedFetch(proxy: BrightDataProxy): typeof fetch {
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

/**
 * Env for the production server Playwright starts. Dummy but valid values:
 * `instrumentation.ts` refuses to boot without them, and the API it points
 * at is the fake one in `fake-artist-api-server.ts`.
 */
const API_URL = 'http://127.0.0.1:3333';

/**
 * Preloaded into the e2e Next server (`--import` below). The image optimizer
 * first checks a URL against `images.remotePatterns` (next.config.ts), then
 * looks the upstream host up in DNS and fetches it. This answers the lookup
 * and the download for the Cover Art Archive from the fake API, so no test
 * reaches the real host. The allowlist still runs first, so a URL the config
 * refuses still fails before any lookup.
 */
const coverUpstreamPreload = `
import dns from 'node:dns';

const UPSTREAM = 'https://coverartarchive.org/';
// The optimizer refuses private addresses, so the lookup answers a public one.
// Nothing is ever sent there: the download below goes to the fake API.
const STAND_IN_ADDRESS = '93.184.216.34';

const realLookup = dns.promises.lookup;
dns.promises.lookup = (hostname, options) => {
  if (hostname !== 'coverartarchive.org') return realLookup(hostname, options);
  const record = { address: STAND_IN_ADDRESS, family: 4 };
  return Promise.resolve(options?.all ? [record] : record);
};

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const href =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (href.startsWith(UPSTREAM)) {
    return realFetch('${API_URL}/__cover/' + href.slice(UPSTREAM.length), init);
  }
  return realFetch(input, init);
};
`;

export const webServerEnv = {
  API_URL,
  NEXT_PUBLIC_API_URL: API_URL,
  REVALIDATE_SECRET: 'e2e-revalidate-secret-not-used-anywhere-else',
  // The sitemap spec sends this host as a forwarded one and expects it back.
  SITEMAP_EXTRA_HOSTS: 'vozzify.example',
  // The practice page plays through a fake clock: YouTube cannot load here.
  E2E_FAKE_PLAYER: 'true',
  // Safe fixture identifiers; the CMP/AdSense requests are intercepted by the
  // Home ads Playwright journey and never reach Google's live inventory.
  ADSENSE_ENABLED: 'true',
  ADSENSE_CLIENT: 'ca-pub-0000000000000000',
  ADSENSE_SLOT: '1234567890',
  ADSENSE_LAYOUT_KEY: '-test-layout-key',
  ADSENSE_CMP_URL: `${API_URL}/__adsense-cmp.js`,
  // A data URL keeps the preload in this file: NODE_OPTIONS is split on
  // spaces, which `encodeURIComponent` removes from the code.
  NODE_OPTIONS: `--import data:text/javascript,${encodeURIComponent(coverUpstreamPreload)}`,
} as const;

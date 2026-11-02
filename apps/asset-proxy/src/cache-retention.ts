import type { AssetProvider } from './provider.js';

const RETAINED_SWR_SECONDS = 14_400;

export const toStoredResponse = (
  response: Response,
  validatedAt: number,
  provider: AssetProvider,
): Response => {
  const headers = new Headers(response.headers);
  headers.set('X-Vozzify-Validated-At', String(validatedAt));
  const maxAge =
    provider.cacheMode === 'stale-while-revalidate'
      ? RETAINED_SWR_SECONDS
      : provider.freshnessSeconds;
  headers.set('Cache-Control', `public, max-age=${maxAge}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

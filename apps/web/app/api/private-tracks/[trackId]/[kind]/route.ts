import { getServerEnv } from '@/lib/env/server';

type RouteContext = {
  params: Promise<{ trackId: string; kind: string }>;
};

const FORWARDED_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-range',
  'content-type',
  'x-content-type-options',
] as const;

/** Proxies authenticated private audio so S3 never receives a browser URL. */
export async function GET(request: Request, context: RouteContext) {
  const { trackId, kind } = await context.params;
  if (kind !== 'music' && kind !== 'vocals') {
    return new Response(null, { status: 404 });
  }
  const incoming = new Headers();
  const cookie = request.headers.get('cookie');
  const range = request.headers.get('range');
  if (cookie) incoming.set('cookie', cookie);
  if (range) incoming.set('range', range);
  const apiUrl = getServerEnv().API_URL.replace(/\/+$/, '');
  const response = await fetch(
    `${apiUrl}/v1/me/private-tracks/${encodeURIComponent(trackId)}/media/${kind}`,
    { headers: incoming, cache: 'no-store' },
  );
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

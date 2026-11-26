// The YouTube video a MusicBrainz link points at (pure). MusicBrainz stores
// the links of a Recording as they were typed, so the same video comes as
// `watch?v=`, `youtu.be/`, `music.youtube.com` or `shorts/`.

/** A YouTube video ID: eleven characters of letters, digits, `-` and `_`. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

/** The path of a YouTube page that carries the video ID as its next segment. */
const VIDEO_PATH = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/;
const SHORT_LINK_PATH = /^\/([^/]+)\/?$/;

/** The video ID a URL names, or undefined when it is not a YouTube video. */
export function youtubeVideoIdOf(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (
    parsed === undefined ||
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    return undefined;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const candidate = idFromHost(host, parsed);
  return candidate !== undefined && VIDEO_ID.test(candidate)
    ? candidate
    : undefined;
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function idFromHost(host: string, url: URL): string | undefined {
  if (host === 'youtu.be') {
    return SHORT_LINK_PATH.exec(url.pathname)?.[1];
  }
  if (!YOUTUBE_HOSTS.has(host)) {
    return undefined;
  }
  if (url.pathname === '/watch') {
    return url.searchParams.get('v') ?? undefined;
  }
  return VIDEO_PATH.exec(url.pathname)?.[1];
}

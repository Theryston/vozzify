import { Test, type TestingModule } from '@nestjs/testing';
import { Innertube } from 'youtubei.js';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

// Replace external I/O at both boundaries: searches use HTTP, details the SDK.
vi.mock('youtubei.js', () => ({ Innertube: { create: vi.fn() } }));

const music = {
  search: vi.fn(),
  getInfo: vi.fn(),
};
const session = { music };
const create = vi.mocked(Innertube.create);
const fetchMock = vi.fn<typeof fetch>();

const BRIGHT_DATA_ENV = {
  BRIGHT_DATA_PROXY_HOST: 'brd.superproxy.io',
  BRIGHT_DATA_PROXY_PORT: 33335,
  BRIGHT_DATA_PROXY_USERNAME: 'user',
  BRIGHT_DATA_PROXY_PASSWORD: 'secret',
};

const song = {
  videoId: 'aaaaaaaaaaa',
  title: 'Bohemian Rhapsody',
  resultType: 'song',
  artists: [{ name: 'Queen', id: 'artist-id' }],
  duration_seconds: 354,
  thumbnails: [
    { url: 'https://img.test/small.jpg', width: 60, height: 60 },
    { url: 'https://img.test/a.jpg', width: 226, height: 226 },
  ],
};

const video = {
  videoId: 'aaaaaaaaaaa',
  title: 'Bohemian Rhapsody',
  artists: ['Queen'],
  durationSeconds: 354,
  kind: 'song',
  artworkUrl: 'https://img.test/a.jpg',
};

describe('YouTubeMusicClient', () => {
  let client: YouTubeMusicClient;
  let moduleRef: TestingModule;

  const configure = async (env: Record<string, unknown> = {}) => {
    moduleRef = await Test.createTestingModule({
      providers: [YouTubeMusicClient, { provide: ENV, useValue: env }],
    }).compile();
    client = moduleRef.get(YouTubeMusicClient);
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    create.mockResolvedValue(session as unknown as Innertube);
    music.getInfo.mockResolvedValue({ basic_info: {} });
    vi.stubGlobal('fetch', fetchMock);
    await configure();
  });

  afterEach(async () => {
    await moduleRef.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens its session on the first video lookup, not at boot or during searches', async () => {
    expect(create).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async () => Response.json([]));

    await client.searchSongs('Queen Bohemian Rhapsody');
    expect(create).not.toHaveBeenCalled();
    await client.getVideo('aaaaaaaaaaa');
    await client.getVideo('aaaaaaaaaaa');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('searches the hosted service, mapping songs to the existing plain videos', async () => {
    fetchMock.mockResolvedValue(Response.json([song]));

    await expect(
      client.searchSongs('Queen Bohemian Rhapsody'),
    ).resolves.toEqual([video]);
    expect(create).not.toHaveBeenCalled();
    expect(music.search).not.toHaveBeenCalled();
  });

  it('sends the complete legacy songs-only parameters and encodes the query', async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    const query = 'Beyoncé & Queen / live?';

    await client.searchSongs(query);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin).toBe(
      'https://j2v0n2sold.execute-api.us-east-1.amazonaws.com',
    );
    expect(url.pathname).toBe('/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query,
      filter: 'songs',
      ignore_spelling: 'false',
      limit: '30',
    });
  });

  it('answers no results when the service returns an empty array', async () => {
    fetchMock.mockResolvedValue(Response.json([]));

    await expect(client.searchSongs('nothing')).resolves.toEqual([]);
  });

  it('reads the basic info of a video', async () => {
    music.getInfo.mockResolvedValue({
      basic_info: {
        title: 'Bohemian Rhapsody',
        duration: 355,
        author: 'Queen Official',
        thumbnail: [],
      },
    });

    await expect(client.getVideo('aaaaaaaaaaa')).resolves.toEqual({
      videoId: 'aaaaaaaaaaa',
      title: 'Bohemian Rhapsody',
      artists: ['Queen Official'],
      durationSeconds: 355,
      kind: 'other',
      artworkUrl: null,
    });
    expect(music.getInfo).toHaveBeenCalledWith('aaaaaaaaaaa');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries opening the video session after a failure, instead of keeping it', async () => {
    create.mockRejectedValueOnce(new Error('network down'));

    await expect(client.getVideo('aaaaaaaaaaa')).rejects.toThrow(
      'network down',
    );
    await expect(client.getVideo('aaaaaaaaaaa')).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('uses the global fetch for video lookups when no proxy is configured', async () => {
    await client.getVideo('aaaaaaaaaaa');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: globalThis.fetch }),
    );
  });

  it('routes video lookups through the configured proxy', async () => {
    await moduleRef.close();
    await configure(BRIGHT_DATA_ENV);

    await client.getVideo('aaaaaaaaaaa');

    const options = create.mock.calls[0]?.[0];
    expect(options?.fetch).toEqual(expect.any(Function));
    expect(options?.fetch).not.toBe(globalThis.fetch);
  });

  it('searches without the YouTube SDK or proxy even when its session cannot open', async () => {
    await moduleRef.close();
    await configure(BRIGHT_DATA_ENV);
    create.mockRejectedValue(
      new Error('Failed to parse URL from [object Request]'),
    );
    fetchMock.mockResolvedValue(Response.json([song]));

    await expect(
      client.searchSongs('Queen Bohemian Rhapsody'),
    ).resolves.toEqual([video]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('omits results without a video ID or title', async () => {
    fetchMock.mockResolvedValue(
      Response.json([
        { ...song, videoId: null },
        { ...song, title: null },
        { title: 'Missing ID' },
        { videoId: 'bbbbbbbbbbb' },
        song,
      ]),
    );

    await expect(client.searchSongs('Queen')).resolves.toEqual([video]);
  });

  it('maps missing optional metadata to the existing empty values', async () => {
    fetchMock.mockResolvedValue(
      Response.json([{ videoId: 'bbbbbbbbbbb', title: 'Song' }]),
    );

    await expect(client.searchSongs('Song')).resolves.toEqual([
      {
        videoId: 'bbbbbbbbbbb',
        title: 'Song',
        artists: [],
        durationSeconds: null,
        kind: 'other',
        artworkUrl: null,
      },
    ]);
  });

  it.each([429, 500, 503])(
    'propagates HTTP %i for pipeline retries',
    async (status) => {
      const response = new Response('upstream unavailable', { status });
      const body = response.body;
      if (body === null) throw new Error('The fixture needs a response body');
      const cancel = vi.spyOn(body, 'cancel');
      fetchMock.mockResolvedValue(response);

      await expect(client.searchSongs('Queen')).rejects.toThrow(
        `YouTube Music search failed with HTTP ${status}`,
      );
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it('propagates an HTTP error even without a response body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));

    await expect(client.searchSongs('Queen')).rejects.toThrow('HTTP 502');
  });

  it.each([{ message: 'Internal Server Error' }, [null], [{ videoId: 123 }]])(
    'rejects malformed response data instead of treating it as no matching video: %j',
    async (body) => {
      fetchMock.mockResolvedValue(Response.json(body));

      await expect(client.searchSongs('Queen')).rejects.toThrow();
    },
  );

  it('propagates invalid JSON for pipeline retries', async () => {
    fetchMock.mockResolvedValue(new Response('<html>upstream error</html>'));

    await expect(client.searchSongs('Queen')).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it.each([
    new TypeError('fetch failed'),
    new DOMException('Timed out', 'TimeoutError'),
  ])('propagates transport failures: %s', async (error) => {
    fetchMock.mockRejectedValue(error);

    await expect(client.searchSongs('Queen')).rejects.toBe(error);
  });

  it('bounds the search request to thirty seconds', async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    fetchMock.mockResolvedValue(Response.json([]));

    await client.searchSongs('Queen');

    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), { signal });
  });
});

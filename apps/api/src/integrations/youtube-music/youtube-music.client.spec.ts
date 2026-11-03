import { Test, type TestingModule } from '@nestjs/testing';
import { Innertube } from 'youtubei.js';
import { ENV } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

vi.mock('youtubei.js', () => ({ Innertube: { create: vi.fn() } }));

const music = { search: vi.fn(), getInfo: vi.fn() };
const session = { music };
const create = vi.mocked(Innertube.create);
const proxyEnv = {
  PROXY_HOST: 'proxy.test',
  PROXY_PORT: 8080,
  PROXY_USERNAME: 'user',
  PROXY_PASSWORD: 'secret',
};
const song = {
  id: 'aaaaaaaaaaa',
  title: 'Bohemian Rhapsody',
  item_type: 'song',
  artists: [{ name: 'Queen' }],
  duration: { seconds: 354 },
  thumbnails: [
    { url: 'https://img.test/small.jpg', width: 60 },
    { url: 'https://img.test/a.jpg', width: 226 },
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
    music.search.mockResolvedValue({ songs: { contents: [] } });
    music.getInfo.mockResolvedValue({ basic_info: {} });
    await configure();
  });

  afterEach(async () => {
    await moduleRef.close();
    vi.restoreAllMocks();
  });

  it('opens a single session on the first search, not at boot', async () => {
    expect(create).not.toHaveBeenCalled();

    await client.searchSongs('Queen Bohemian Rhapsody');
    await client.searchSongs('Queen Bohemian Rhapsody');
    await client.getVideo('aaaaaaaaaaa');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('maps the SDK songs to the existing plain videos', async () => {
    music.search.mockResolvedValue({ songs: { contents: [song] } });

    await expect(
      client.searchSongs('Queen Bohemian Rhapsody'),
    ).resolves.toEqual([video]);
  });

  it('sends the original query with the songs-only filter', async () => {
    const query = 'Beyoncé & Queen / live?';

    await client.searchSongs(query);

    expect(music.search).toHaveBeenCalledExactlyOnceWith(query, {
      type: 'song',
    });
  });

  it.each([{}, { songs: {} }, { songs: { contents: [] } }])(
    'answers no results when the SDK has no songs: %j',
    async (response) => {
      music.search.mockResolvedValue(response);

      await expect(client.searchSongs('nothing')).resolves.toEqual([]);
    },
  );

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
  });

  it('retries opening the search session after a failure', async () => {
    create.mockRejectedValueOnce(new Error('network down'));

    await expect(client.searchSongs('Queen')).rejects.toThrow('network down');
    await expect(client.searchSongs('Queen')).resolves.toEqual([]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries opening the video session after a failure', async () => {
    create.mockRejectedValueOnce(new Error('network down'));

    await expect(client.getVideo('aaaaaaaaaaa')).rejects.toThrow(
      'network down',
    );
    await expect(client.getVideo('aaaaaaaaaaa')).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('uses global fetch when no proxy is configured', async () => {
    await client.searchSongs('Queen');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: globalThis.fetch }),
    );
  });

  it('uses Brazilian location and keeps English shelf names for the SDK parser', async () => {
    await client.searchSongs('Queen');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        location: 'BR',
        lang: 'en',
        retrieve_player: true,
      }),
    );
  });

  it('shares the configured proxy between searches and video lookups', async () => {
    await moduleRef.close();
    await configure(proxyEnv);

    await client.searchSongs('Queen');
    await client.getVideo('aaaaaaaaaaa');

    expect(create).toHaveBeenCalledOnce();
    const options = create.mock.calls[0]?.[0];
    expect(options?.fetch).toEqual(expect.any(Function));
    expect(options?.fetch).not.toBe(globalThis.fetch);
  });

  it('omits results without a video ID or title', async () => {
    music.search.mockResolvedValue({
      songs: {
        contents: [
          { ...song, id: undefined },
          { ...song, title: undefined },
          { title: 'Missing ID', thumbnails: [] },
          { id: 'bbbbbbbbbbb', thumbnails: [] },
          song,
        ],
      },
    });

    await expect(client.searchSongs('Queen')).resolves.toEqual([video]);
  });

  it('maps missing optional metadata to the existing empty values', async () => {
    music.search.mockResolvedValue({
      songs: {
        contents: [{ id: 'bbbbbbbbbbb', title: 'Song', thumbnails: [] }],
      },
    });

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

  it.each([
    new Error('HTTP 429'),
    new Error('HTTP 500'),
    new Error('HTTP 502'),
    new Error('HTTP 503'),
    new Error('Response did not contain any contents'),
    new SyntaxError('Invalid JSON'),
    new TypeError('fetch failed'),
    new DOMException('Timed out', 'TimeoutError'),
  ])(
    'propagates SDK search failures for pipeline retries: %s',
    async (error) => {
      music.search.mockRejectedValueOnce(error);

      await expect(client.searchSongs('Queen')).rejects.toBe(error);
      await expect(client.searchSongs('Queen')).resolves.toEqual([]);
      expect(create).toHaveBeenCalledOnce();
    },
  );
});

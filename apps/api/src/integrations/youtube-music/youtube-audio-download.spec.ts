import { Innertube, Platform } from 'youtubei.js';
import type { Env } from '../../config/env.js';
import { YouTubeMusicClient } from './youtube-music.client.js';

vi.mock('youtubei.js', () => ({
  Innertube: { create: vi.fn() },
  Platform: { shim: { eval: vi.fn() } },
}));

describe('YouTube audio download session', () => {
  const create = vi.mocked(Innertube.create);
  const download = vi.fn();
  const request = vi.fn<typeof fetch>();
  let client: YouTubeMusicClient;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', request);
    request.mockResolvedValue(new Response('ok'));
    create.mockResolvedValue({ download } as unknown as Innertube);
    download.mockResolvedValue(new Response('audio').body);
    client = new YouTubeMusicClient({} as Env);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads audio with Brazilian context, a decipher evaluator and no PO token', async () => {
    const media = await client.downloadAudio(
      'video-id',
      new AbortController().signal,
    );

    expect(media).toBeInstanceOf(ReadableStream);
    expect(download).toHaveBeenCalledExactlyOnceWith('video-id', {
      type: 'audio',
      quality: 'best',
      format: 'any',
      client: 'VISIONOS',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'BR', retrieve_player: true }),
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('po_token');
    expect(Platform.shim.eval).toEqual(expect.any(Function));
  });

  it('does not initialize a download that is already cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      client.downloadAudio('video-id', abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['url', 'native-request', 'explicit-signal'])(
    'propagates the overall deadline through %s fetch inputs',
    async (kind) => {
      const deadline = new AbortController();
      const original = new AbortController();
      await client.downloadAudio('video-id', deadline.signal);
      const fetchMedia = create.mock.calls[0]?.[0]?.fetch;
      if (!fetchMedia) throw new Error('Expected a download fetch');
      const url = 'https://media.test/audio';
      const input =
        kind === 'native-request'
          ? new Request(url, { signal: original.signal })
          : new URL(url);
      await fetchMedia(
        input,
        kind === 'explicit-signal' ? { signal: original.signal } : undefined,
      );

      const forwarded = request.mock.calls[0]?.[1]?.signal;
      expect(forwarded?.aborted).toBe(false);
      deadline.abort();
      expect(forwarded?.aborted).toBe(true);
    },
  );

  it('preserves the SDK media request cancellation signal', async () => {
    const original = new AbortController();
    await client.downloadAudio('video-id', new AbortController().signal);
    const fetchMedia = create.mock.calls[0]?.[0]?.fetch;
    if (!fetchMedia) throw new Error('Expected a download fetch');
    await fetchMedia(
      new Request('https://media.test/audio', { signal: original.signal }),
    );
    original.abort();
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('propagates a playback failure instead of returning an empty stream', async () => {
    download.mockRejectedValue(new Error('Video is unplayable'));
    await expect(
      client.downloadAudio('video-id', new AbortController().signal),
    ).rejects.toThrow('Video is unplayable');
  });
});

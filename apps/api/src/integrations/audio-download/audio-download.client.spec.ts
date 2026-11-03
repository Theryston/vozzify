import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YouTubeMusicClient } from '../youtube-music/youtube-music.client.js';
import { AudioDownloadClient } from './audio-download.client.js';

const youtube = { downloadAudio: vi.fn() };
const client = new AudioDownloadClient(
  youtube as unknown as YouTubeMusicClient,
);

describe('AudioDownloadClient direct streaming', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    dir = await mkdtemp(join(tmpdir(), 'download-spec-'));
    path = join(dir, 'audio.source');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes successive chunks to disk without returning a complete audio buffer', async () => {
    youtube.downloadAudio.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
    );

    await expect(
      client.downloadToFile('video-id', path),
    ).resolves.toBeUndefined();

    expect(await readFile(path)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(youtube.downloadAudio).toHaveBeenCalledExactlyOnceWith(
      'video-id',
      expect.any(AbortSignal),
    );
  });

  it('bounds initialization and transfer with the same two-minute deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const failure = new Error('YouTube refused the video');
    youtube.downloadAudio.mockRejectedValue(failure);

    await expect(client.downloadToFile('video-id', path)).rejects.toBe(failure);

    expect(timeout).toHaveBeenCalledWith(120_000);
    expect(youtube.downloadAudio.mock.calls[0]?.[1]).toBe(
      timeout.mock.results[0]?.value,
    );
  });

  it('rejects empty media instead of uploading an empty object', async () => {
    youtube.downloadAudio.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    );

    await expect(client.downloadToFile('video-id', path)).rejects.toThrow(
      'empty',
    );
  });

  it('rejects an oversized transfer and cancels its producer', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const cancel = vi.fn();
    youtube.downloadAudio.mockResolvedValue(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel,
      }),
    );

    await expect(client.downloadToFile('video-id', path)).rejects.toThrow(
      'larger than the accepted size',
    );

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('propagates a media connection failure after partial data', async () => {
    let sent = false;
    youtube.downloadAudio.mockResolvedValue(
      new ReadableStream({
        pull(controller) {
          if (sent) controller.error(new Error('connection lost'));
          else {
            controller.enqueue(new Uint8Array([1]));
            sent = true;
          }
        },
      }),
    );

    await expect(client.downloadToFile('video-id', path)).rejects.toThrow(
      'connection lost',
    );
  });

  it('cancels a stalled stream when its deadline expires', async () => {
    const abort = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
    const cancel = vi.fn();
    let started: (() => void) | undefined;
    const streaming = new Promise<void>((resolve) => {
      started = resolve;
    });
    youtube.downloadAudio.mockResolvedValue(
      new ReadableStream({
        pull() {
          started?.();
        },
        cancel,
      }),
    );
    const download = client.downloadToFile('video-id', path);
    const rejected = expect(download).rejects.toMatchObject({
      name: 'AbortError',
    });
    await streaming;
    abort.abort();

    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not overwrite an existing file', async () => {
    youtube.downloadAudio.mockImplementation(
      async () => new Response('audio').body,
    );
    await client.downloadToFile('video-id', path);

    await expect(client.downloadToFile('video-id', path)).rejects.toThrow(
      'EEXIST',
    );
    expect(await readFile(path, 'utf8')).toBe('audio');
  });
});

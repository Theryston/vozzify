import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '../../config/env.js';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import { PrivateAudioInspector } from './private-audio.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const spawnMock = vi.mocked(spawn);

describe('PrivateAudioInspector', () => {
  let directory: string;
  let path: string;
  let inspector: PrivateAudioInspector;
  let ffmpeg: FfmpegClient;

  const runProbe = (output: unknown, code = 0) => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      Object.assign(child, { stdout: Readable.from([JSON.stringify(output)]) });
      setImmediate(() => child.emit('close', code));
      return child;
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'private-audio-spec-'));
    path = join(directory, 'source.audio');
    await writeFile(path, 'same file bytes');
    ffmpeg = new FfmpegClient({} as Env);
    vi.spyOn(ffmpeg, 'validateAudioFile').mockResolvedValue();
    inspector = new PrivateAudioInspector(ffmpeg);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads embedded title and artist tags after a complete decode', async () => {
    runProbe({
      streams: [
        {
          codec_type: 'audio',
          duration: '1800',
          tags: { TITLE: '  Track title  ', ARTIST: 'Singer' },
        },
      ],
      format: {},
    });
    await expect(inspector.inspect(path)).resolves.toEqual({
      durationMs: 1_800_000,
      title: 'Track title',
      artist: 'Singer',
    });
    expect(ffmpeg.validateAudioFile).toHaveBeenCalledWith(path);
    expect(spawnMock).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining([
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'aac,ac3,aiff,amr,ape,asf,au,flac,matroska,mp3,mov,ogg,tta,wav,wv',
        '/proc/self/fd/3',
      ]),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('uses container tags when audio-stream tags are absent', async () => {
    runProbe({
      streams: [{ codec_type: 'audio', duration: '1.25', tags: {} }],
      format: { tags: { TITLE: 'Container title' } },
    });
    await expect(inspector.inspect(path)).resolves.toMatchObject({
      title: 'Container title',
      durationMs: 1250,
    });
  });

  it('allows missing tags for filename fallback and empty artist', async () => {
    runProbe({
      streams: [{ codec_type: 'audio', duration: '1.25' }],
      format: { duration: '1.25' },
    });
    await expect(inspector.inspect(path)).resolves.toEqual({
      durationMs: 1250,
      title: '',
      artist: '',
    });
  });

  it('rejects video-only and undecodable files', async () => {
    runProbe({ streams: [{ codec_type: 'video' }], format: { duration: '1' } });
    await expect(inspector.inspect(path)).rejects.toMatchObject({
      status: 400,
    });
    expect(ffmpeg.validateAudioFile).not.toHaveBeenCalled();

    runProbe({ streams: [{ codec_type: 'audio', duration: '1' }] });
    vi.mocked(ffmpeg.validateAudioFile).mockRejectedValueOnce(new Error('bad'));
    await expect(inspector.inspect(path)).rejects.toMatchObject({
      status: 400,
    });
  });

  it.each(['0', '-1', '1800.001', 'NaN'])(
    'rejects invalid duration %s',
    async (duration) => {
      runProbe({ streams: [{ codec_type: 'audio', duration }] });
      await expect(inspector.inspect(path)).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it('rejects a failed probe process', async () => {
    runProbe({}, 1);
    await expect(inspector.inspect(path)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('hashes the complete file content', async () => {
    await expect(inspector.hash(path)).resolves.toBe(
      'ff9c59636968b60404f21e13334c3f4a3d1c56c25d12ce9652a3b1295adda2a3',
    );
  });
});

import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { type Env } from '../../config/env.js';
import { FfmpegClient } from './ffmpeg.client.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const spawnMock = vi.mocked(spawn);
const wav = new Uint8Array([82, 73, 70, 70]);
const runningFfmpeg = (outcome: {
  code?: number;
  stderr?: string;
  error?: Error;
  oversized?: boolean;
  oversizedAt?: number;
}) => {
  spawnMock.mockImplementation((_command, args) => {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    Object.assign(child, { stderr: Readable.from([outcome.stderr ?? '']) });
    const output = args?.at(-1) ?? '';
    setImmediate(async () => {
      if (outcome.error !== undefined) {
        child.emit('error', outcome.error);
        return;
      }
      if ((outcome.code ?? 0) === 0) {
        await writeFile(output, wav);
        if (outcome.oversized) {
          await truncate(
            output,
            (outcome.oversizedAt ?? 256 * 1024 * 1024) + 1,
          );
        }
      }
      child.emit('close', outcome.code ?? 0);
    });
    return child;
  });
};

describe('FfmpegClient file conversion', () => {
  let dir: string;
  let input: string;
  let output: string;
  let client: FfmpegClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(join(tmpdir(), 'ffmpeg-file-spec-'));
    input = join(dir, 'audio.source');
    output = join(dir, 'music.wav');
    await writeFile(input, new Uint8Array([1, 2, 3]));
    client = new FfmpegClient({} as Env);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('converts audio files to bounded 16-bit PCM WAV without buffering the output', async () => {
    runningFfmpeg({});
    await expect(
      client.convertAudioFileToWav(input, output),
    ).resolves.toBeUndefined();
    expect(spawnMock.mock.calls[0]?.[0]).toBe('ffmpeg');
    expect(spawnMock.mock.calls[0]?.[1]).toEqual([
      '-y',
      '-i',
      input,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '44100',
      '-fs',
      '268435457',
      output,
    ]);
    expect(await readFile(output)).toEqual(Buffer.from(wav));
    expect(await readFile(input)).toEqual(Buffer.from([1, 2, 3]));
  });
  it('runs the binary named by FFMPEG_PATH', async () => {
    client = new FfmpegClient({ FFMPEG_PATH: '/opt/ffmpeg/bin/ffmpeg' } as Env);
    runningFfmpeg({});
    await client.convertAudioFileToWav(input, output);
    expect(spawnMock.mock.calls[0]?.[0]).toBe('/opt/ffmpeg/bin/ffmpeg');
  });
  it('bounds the conversion duration', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    runningFfmpeg({});
    try {
      await client.convertAudioFileToWav(input, output);
      expect(timeout).toHaveBeenCalledWith(120_000);
    } finally {
      timeout.mockRestore();
    }
  });
  it('propagates ffmpeg failure with a bounded stderr tail', async () => {
    runningFfmpeg({ code: 1, stderr: `${'x'.repeat(3000)}Invalid audio` });
    await expect(client.convertAudioFileToWav(input, output)).rejects.toThrow(
      `ffmpeg exited with code 1: ${'x'.repeat(1987)}Invalid audio`,
    );
  });
  it('propagates a process startup failure', async () => {
    runningFfmpeg({ error: new Error('spawn ffmpeg ENOENT') });
    await expect(client.convertAudioFileToWav(input, output)).rejects.toThrow(
      'spawn ffmpeg ENOENT',
    );
  });
  it('rejects a WAV that reaches the output cap instead of uploading truncated audio', async () => {
    runningFfmpeg({ oversized: true });
    await expect(client.convertAudioFileToWav(input, output)).rejects.toThrow(
      'WAV is larger',
    );
  });
  it('keeps stereo private audio and allows a 30-minute 44.1 kHz WAV', async () => {
    runningFfmpeg({});
    await client.convertPrivateAudioFileToWav(input, output);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual([
      '-y',
      '-i',
      input,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-fs',
      '335544321',
      output,
    ]);
    // 30m * 44,100 frames/s * two 16-bit channels fits the private cap.
    expect(30 * 60 * 44_100 * 2 * 2).toBeLessThan(320 * 1024 * 1024);
  });
  it('rejects private WAV output above its dedicated cap', async () => {
    runningFfmpeg({ oversized: true, oversizedAt: 320 * 1024 * 1024 });
    await expect(
      client.convertPrivateAudioFileToWav(input, output),
    ).rejects.toThrow('WAV is larger');
  });
});

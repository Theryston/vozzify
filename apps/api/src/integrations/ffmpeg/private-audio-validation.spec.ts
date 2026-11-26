import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '../../config/env.js';
import { FfmpegClient } from './ffmpeg.client.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const spawnMock = vi.mocked(spawn);

describe('FfmpegClient private audio validation', () => {
  let directory: string;
  let filePath: string;
  let client: FfmpegClient;

  const runDecoder = (progress: string, code: number | null = 0) => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      const kill = vi.fn();
      Object.assign(child, {
        stdout: Readable.from([progress]),
        stderr: Readable.from([]),
        kill,
      });
      setImmediate(() => child.emit('close', code));
      return child;
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'private-audio-validation-'));
    filePath = join(directory, 'upload.bin');
    await writeFile(filePath, 'audio bytes');
    client = new FfmpegClient({} as Env);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reports complete decoded duration from progress output', async () => {
    runDecoder('out_time_us=1250000\nprogress=end\n');
    await expect(client.validateAudioFile(filePath, 1800)).resolves.toBe(1.25);
    const [binary, args, options] = spawnMock.mock.calls[0] ?? [];
    expect(binary).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        expect.any(String),
        '-i',
        '/proc/self/fd/3',
        '-map',
        '0:a:0',
        '-progress',
        'pipe:1',
      ]),
    );
    expect(options?.stdio).toEqual([
      'ignore',
      'pipe',
      'pipe',
      expect.any(Number),
    ]);
  });

  it('stops decoding when actual output duration passes the limit', async () => {
    runDecoder('out_time_us=1800001001\nprogress=continue\n', null);
    await expect(client.validateAudioFile(filePath, 1800)).rejects.toThrow(
      'Media duration exceeds its limit',
    );
  });

  it('measures the full video timeline separately from decoding its audio', async () => {
    runDecoder('out_time_us=1800000000\nprogress=end\n');
    await expect(client.validateVideoFile(filePath, 1800)).resolves.toBe(1800);
    const commandArguments = spawnMock.mock.calls.map(([, args]) => args);
    expect(commandArguments).toContainEqual(
      expect.arrayContaining([
        '-map',
        '0:V',
        '0:a:0',
        '-c',
        'copy',
        '-f',
        'null',
      ]),
    );
    expect(commandArguments).toContainEqual(
      expect.arrayContaining(['0:a:0', '-vn', '-t', '1800', '-f', 'null']),
    );
  });
});

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Env } from '../src/config/env.js';
import { FfmpegClient } from '../src/integrations/ffmpeg/ffmpeg.client.js';

const run = promisify(execFile);
const probeSchema = z.object({
  streams: z.array(
    z.object({ sample_rate: z.string(), codec_name: z.string() }),
  ),
});

describe('FFmpeg sample-rate normalization (e2e)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vozzify-sample-rate-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([48000, 44100])(
    'converts %i Hz downloaded audio to the detector-compatible WAV format',
    async (sampleRate) => {
      const input = join(dir, 'download.m4a');
      const output = join(dir, 'music.wav');
      await run('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:sample_rate=${sampleRate}`,
        '-t',
        '0.05',
        '-c:a',
        'aac',
        input,
      ]);

      await new FfmpegClient({} as Env).convertAudioFileToWav(input, output);

      const { stdout } = await run('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=sample_rate,codec_name',
        '-of',
        'json',
        output,
      ]);
      expect(probeSchema.parse(JSON.parse(stdout)).streams).toEqual([
        { sample_rate: '44100', codec_name: 'pcm_s16le' },
      ]);
    },
  );
});

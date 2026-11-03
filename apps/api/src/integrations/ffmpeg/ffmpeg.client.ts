import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';

// The ffmpeg binary that converts the downloaded audio (ADR 0014). It is the
// only code that runs ffmpeg: features depend on this class, so tests replace
// it at this boundary.
const DEFAULT_FFMPEG_PATH = 'ffmpeg';
// A conversion of a 15-minute track takes seconds; a hung process is killed.
const CONVERSION_TIMEOUT_MS = 2 * 60_000;
// The end of ffmpeg's log is where its error is.
const STDERR_TAIL_CHARS = 2_000;
const MAX_WAV_BYTES = 256 * 1024 * 1024;

@Injectable()
export class FfmpegClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Converts any supported audio container without buffering either file.
   * The detector requires 44.1 kHz PCM, regardless of the source sample rate.
   * The caller owns both temporary paths and removes them after uploading.
   */
  async convertAudioFileToWav(input: string, output: string): Promise<void> {
    await this.run([
      '-y',
      '-i',
      input,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '44100',
      '-fs',
      String(MAX_WAV_BYTES + 1),
      output,
    ]);
    if ((await stat(output)).size > MAX_WAV_BYTES) {
      throw new Error('The WAV is larger than the accepted size');
    }
  }

  /**
   * Converts a WAV to MP3 with the parameters of the legacy service: the audio
   * only, as LAME's MP3 at VBR quality 2 (`-q:a 2`).
   */
  async convertWavToMp3(wav: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    return this.convert(wav, 'audio.wav', 'audio.mp3', [
      '-vn',
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '2',
    ]);
  }

  /** Runs one conversion in a temporary directory, removed whatever the outcome. */
  private async convert(
    input: Uint8Array,
    inputName: string,
    outputName: string,
    options: string[],
  ): Promise<Uint8Array<ArrayBuffer>> {
    const dir = await mkdtemp(join(tmpdir(), 'vozzify-audio-'));
    try {
      const inputPath = join(dir, inputName);
      const outputPath = join(dir, outputName);
      await writeFile(inputPath, input);
      await this.run(['-y', '-i', inputPath, ...options, outputPath]);
      return new Uint8Array(await readFile(outputPath));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.env.FFMPEG_PATH ?? DEFAULT_FFMPEG_PATH, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARS);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      });
    });
  }
}

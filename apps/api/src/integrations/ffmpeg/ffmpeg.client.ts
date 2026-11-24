import { spawn } from 'node:child_process';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PRIVATE_AUDIO_FORMAT_WHITELIST } from './private-audio-formats.js';

// The ffmpeg binary that converts the downloaded audio (ADR 0014). It is the
// only code that runs ffmpeg: features depend on this class, so tests replace
// it at this boundary.
const DEFAULT_FFMPEG_PATH = 'ffmpeg';
const DEFAULT_FFPROBE_PATH = 'ffprobe';
const PRIVATE_AUDIO_DECODE_ARGS = [
  '-v',
  'error',
  '-protocol_whitelist',
  'file',
  '-format_whitelist',
  PRIVATE_AUDIO_FORMAT_WHITELIST,
  '-i',
  '/proc/self/fd/3',
  '-map',
  '0:a:0',
  '-vn',
  '-sn',
  '-dn',
  '-threads',
  '1',
  '-nostats',
  '-stats_period',
  '0.25',
  '-progress',
  'pipe:1',
  '-f',
  'null',
  '-',
];
// A conversion of a 15-minute track takes seconds; a hung process is killed.
const CONVERSION_TIMEOUT_MS = 2 * 60_000;
// The end of ffmpeg's log is where its error is.
const STDERR_TAIL_CHARS = 2_000;
const MAX_WAV_BYTES = 256 * 1024 * 1024;
const MAX_PRIVATE_WAV_BYTES = 320 * 1024 * 1024;

@Injectable()
export class FfmpegClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get ffprobePath(): string {
    return this.env.FFPROBE_PATH ?? DEFAULT_FFPROBE_PATH;
  }

  /**
   * Converts any supported audio container without buffering either file.
   * The detector requires 44.1 kHz PCM, regardless of the source sample rate.
   * The caller owns both temporary paths and removes them after uploading.
   */
  async convertAudioFileToWav(input: string, output: string): Promise<void> {
    await this.convertAudioFileToWavWithLimit(input, output, MAX_WAV_BYTES);
  }

  /** Keep both channels of private recordings while allowing a 30-minute WAV. */
  async convertPrivateAudioFileToWav(
    input: string,
    output: string,
  ): Promise<void> {
    await this.convertAudioFileToWavWithLimit(
      input,
      output,
      MAX_PRIVATE_WAV_BYTES,
      2,
    );
  }

  private async convertAudioFileToWavWithLimit(
    input: string,
    output: string,
    maxBytes: number,
    channels?: number,
  ): Promise<void> {
    const args = [
      '-y',
      '-i',
      input,
      '-vn',
      '-acodec',
      'pcm_s16le',
      ...(channels === undefined ? [] : ['-ac', String(channels)]),
      '-ar',
      '44100',
      '-fs',
      String(maxBytes + 1),
      output,
    ];
    await this.run(args);
    if ((await stat(output)).size > maxBytes) {
      throw new Error('The WAV is larger than the accepted size');
    }
  }

  /** Decode only the first audio stream from the self-contained uploaded file. */
  async validateAudioFile(
    input: string,
    maxDurationSeconds: number,
  ): Promise<number> {
    const file = await open(input, 'r');
    try {
      return await this.decodeForValidation(file.fd, maxDurationSeconds);
    } finally {
      await file.close();
    }
  }

  private decodeForValidation(
    inputFd: number,
    maxDurationSeconds: number,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.env.FFMPEG_PATH ?? DEFAULT_FFMPEG_PATH,
        PRIVATE_AUDIO_DECODE_ARGS,
        {
          stdio: ['ignore', 'pipe', 'pipe', inputFd],
          signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
        },
      );
      let progressBuffer = '';
      let stderr = '';
      let durationUs = 0;
      let durationExceeded = false;
      child.stdout?.on('data', (chunk: Buffer) => {
        const update = readProgress(
          progressBuffer,
          chunk.toString(),
          durationUs,
          maxDurationSeconds,
        );
        progressBuffer = update.buffer;
        durationUs = update.durationUs;
        durationExceeded ||= update.durationExceeded;
        if (update.outputExceeded || update.durationExceeded) {
          child.kill('SIGKILL');
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARS);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (durationExceeded) {
          reject(new Error('Audio duration exceeds its limit'));
          return;
        }
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
          return;
        }
        resolve(durationUs / 1_000_000);
      });
    });
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

  private run(args: string[], inputFd?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.env.FFMPEG_PATH ?? DEFAULT_FFMPEG_PATH, args, {
        stdio:
          inputFd === undefined
            ? ['ignore', 'ignore', 'pipe']
            : ['ignore', 'ignore', 'pipe', inputFd],
        signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
      });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
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

function readProgress(
  buffer: string,
  chunk: string,
  currentDurationUs: number,
  maxDurationSeconds: number,
) {
  const output = buffer + chunk;
  if (output.length > 32_000) {
    return {
      buffer: '',
      durationUs: currentDurationUs,
      durationExceeded: false,
      outputExceeded: true,
    };
  }
  const lines = output.split('\n');
  const remaining = lines.pop() ?? '';
  let durationUs = currentDurationUs;
  let durationExceeded = false;
  for (const line of lines) {
    if (!line.startsWith('out_time_us=')) continue;
    const parsed = Number(line.slice('out_time_us='.length));
    if (!Number.isFinite(parsed)) continue;
    durationUs = Math.max(durationUs, parsed);
    if (durationUs > maxDurationSeconds * 1_000_000) {
      durationExceeded = true;
      break;
    }
  }
  return {
    buffer: remaining,
    durationUs,
    durationExceeded,
    outputExceeded: false,
  };
}

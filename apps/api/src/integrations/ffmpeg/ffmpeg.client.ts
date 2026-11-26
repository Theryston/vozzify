import { spawn } from 'node:child_process';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import {
  FFMPEG_STDERR_TAIL_CHARS,
  readFfmpegDuration,
} from './ffmpeg-progress.js';
import { PRIVATE_AUDIO_FORMAT_WHITELIST } from './private-audio-formats.js';

// The ffmpeg binary that converts the downloaded audio (ADR 0014). It is the
// only code that runs ffmpeg: features depend on this class, so tests replace
// it at this boundary.
const DEFAULT_FFMPEG_PATH = 'ffmpeg';
const DEFAULT_FFPROBE_PATH = 'ffprobe';
const PRIVATE_MEDIA_INPUT_ARGS = [
  '-v',
  'error',
  '-protocol_whitelist',
  'file',
  '-format_whitelist',
  PRIVATE_AUDIO_FORMAT_WHITELIST,
  '-i',
  '/proc/self/fd/3',
];
const PRIVATE_MEDIA_PROGRESS_ARGS = [
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
const FIRST_AUDIO_STREAM_ARGS = ['-map', '0:a:0', '-vn', '-sn', '-dn'];
// A conversion of a 15-minute track takes seconds; a hung process is killed.
const CONVERSION_TIMEOUT_MS = 2 * 60_000;
const MAX_WAV_BYTES = 256 * 1024 * 1024;
const MAX_PRIVATE_WAV_BYTES = 320 * 1024 * 1024;

// A full decoder frame may include padding past the last timed AAC sample.
const AUDIO_FRAME_MARGIN_SECONDS = 0.15;
const DECODED_AUDIO_TIMESTAMPS = 'asetpts=N/SR/TB';

type PrivateWavOptions = {
  durationLimitSeconds?: number;
  normalizeTimestamps?: boolean;
};

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
    { durationLimitSeconds, normalizeTimestamps }: PrivateWavOptions = {},
  ): Promise<void> {
    const file = await open(input, 'r');
    try {
      await this.run(
        [
          '-y',
          ...PRIVATE_MEDIA_INPUT_ARGS,
          ...FIRST_AUDIO_STREAM_ARGS,
          ...(durationLimitSeconds === undefined
            ? []
            : ['-t', String(durationLimitSeconds)]),
          '-map_metadata',
          '-1',
          '-map_chapters',
          '-1',
          '-threads',
          '1',
          ...(normalizeTimestamps ? ['-af', DECODED_AUDIO_TIMESTAMPS] : []),
          '-acodec',
          'pcm_s16le',
          '-ac',
          '2',
          '-ar',
          '44100',
          '-fs',
          String(MAX_PRIVATE_WAV_BYTES + 1),
          output,
        ],
        file.fd,
      );
      if ((await stat(output)).size > MAX_PRIVATE_WAV_BYTES) {
        throw new Error('The WAV is larger than the accepted size');
      }
    } finally {
      await file.close();
    }
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

  /** Chromaprint expects the first 120 seconds, alongside the full duration. */
  async fingerprintWav(input: string, output: string): Promise<string | null> {
    await this.run([
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-f',
      'wav',
      '-i',
      input,
      '-t',
      '120',
      '-map',
      '0:a:0',
      '-f',
      'chromaprint',
      output,
    ]);
    const fingerprint = (await readFile(output, 'utf8')).trim();
    // Chromaprint writes a four-byte header even when the sample is too short.
    return Buffer.from(fingerprint, 'base64url').length > 4
      ? fingerprint
      : null;
  }

  /** Decode only the first audio stream from the self-contained uploaded file. */
  async validateAudioFile(
    input: string,
    maxDurationSeconds: number,
  ): Promise<number> {
    return this.validateMediaDuration(
      input,
      maxDurationSeconds,
      FIRST_AUDIO_STREAM_ARGS,
    );
  }

  /** Check the whole video and return the duration of its playable audio. */
  async validateVideoFile(
    input: string,
    maxDurationSeconds: number,
  ): Promise<number> {
    const [audioDuration] = await Promise.all([
      this.validateMediaDuration(input, maxDurationSeconds, [
        ...FIRST_AUDIO_STREAM_ARGS,
        '-t',
        String(maxDurationSeconds),
      ]),
      // Packet timestamps measure the entire source without decoding imagery
      // or counting codec padding after the last audio packet's timed samples.
      this.validateMediaDuration(input, maxDurationSeconds, [
        '-map',
        '0:V',
        '-map',
        '0:a:0',
        '-c',
        'copy',
        '-sn',
        '-dn',
      ]),
    ]);
    return audioDuration;
  }

  /** Validate decoded samples and distinguish AAC padding from excess duration. */
  async validateYouTubeAudioFile(
    input: string,
    maxDurationSeconds: number,
  ): Promise<number> {
    // Opus can carry a negative initial timestamp even after decoder delay is removed.
    const decodedDuration = await this.validateMediaDuration(
      input,
      maxDurationSeconds + AUDIO_FRAME_MARGIN_SECONDS,
      [...FIRST_AUDIO_STREAM_ARGS, '-af', DECODED_AUDIO_TIMESTAMPS],
    );
    if (decodedDuration <= maxDurationSeconds) return decodedDuration;
    return this.validateMediaDuration(input, maxDurationSeconds, [
      '-map',
      '0:a:0',
      '-c',
      'copy',
    ]);
  }

  private async validateMediaDuration(
    input: string,
    maxDurationSeconds: number,
    streams: string[],
  ): Promise<number> {
    const file = await open(input, 'r');
    try {
      return await readFfmpegDuration({
        executable: this.env.FFMPEG_PATH ?? DEFAULT_FFMPEG_PATH,
        args: [
          ...PRIVATE_MEDIA_INPUT_ARGS,
          ...streams,
          ...PRIVATE_MEDIA_PROGRESS_ARGS,
        ],
        inputFd: file.fd,
        maxDurationSeconds,
        timeoutMs: CONVERSION_TIMEOUT_MS,
      });
    } finally {
      await file.close();
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
        stderr = `${stderr}${chunk}`.slice(-FFMPEG_STDERR_TAIL_CHARS);
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

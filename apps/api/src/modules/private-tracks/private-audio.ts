import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { PRIVATE_AUDIO_MAX_DURATION_SECONDS } from '@vozzify/contracts';
import { z } from 'zod';
import { ZodValidationException } from '../../common/zod/zod-validation.pipe.js';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import { PRIVATE_AUDIO_FORMAT_WHITELIST } from '../../integrations/ffmpeg/private-audio-formats.js';

type AudioMetadata = { durationMs: number; title: string; artist: string };

export const invalidPrivateAudio = (message: string) =>
  new ZodValidationException(
    new z.ZodError([{ code: 'custom', path: ['audio'], message }]),
    'body',
  );

@Injectable()
export class PrivateAudioInspector {
  constructor(private readonly ffmpeg: FfmpegClient) {}

  async inspect(filePath: string): Promise<AudioMetadata> {
    let probe: ProbeResult;
    try {
      probe = await this.probe(filePath);
    } catch {
      throw invalidPrivateAudio('Audio could not be decoded');
    }
    const stream = probe.streams?.[0];
    if (stream?.codec_type !== 'audio') {
      throw invalidPrivateAudio(
        'Audio must be decodable and no longer than 30 minutes',
      );
    }
    let duration: number;
    try {
      duration = await this.ffmpeg.validateAudioFile(
        filePath,
        PRIVATE_AUDIO_MAX_DURATION_SECONDS,
      );
    } catch {
      throw invalidPrivateAudio('Audio could not be decoded');
    }
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > PRIVATE_AUDIO_MAX_DURATION_SECONDS
    ) {
      throw invalidPrivateAudio(
        'Audio must be decodable and no longer than 30 minutes',
      );
    }
    const streamTags = stream.tags ?? {};
    const formatTags = probe.format?.tags ?? {};
    return {
      durationMs: Math.round(duration * 1000),
      title: tagValue(streamTags, 'title') || tagValue(formatTags, 'title'),
      artist: tagValue(streamTags, 'artist') || tagValue(formatTags, 'artist'),
    };
  }

  async hash(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  }

  private async probe(filePath: string): Promise<ProbeResult> {
    const file = await open(filePath, 'r');
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(
          this.ffmpeg.ffprobePath,
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file',
            '-format_whitelist',
            PRIVATE_AUDIO_FORMAT_WHITELIST,
            '-select_streams',
            'a:0',
            '-show_entries',
            'stream=codec_type,duration:stream_tags=title,artist:format=duration:format_tags=title,artist',
            '-show_format',
            '-of',
            'json',
            '/proc/self/fd/3',
          ],
          {
            stdio: ['ignore', 'pipe', 'ignore', file.fd],
            signal: AbortSignal.timeout(30_000),
          },
        );
        let output = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.length > 64_000) child.kill('SIGKILL');
        });
        child.once('error', reject);
        child.once('close', (code) => {
          if (code !== 0) {
            reject(new Error('Audio probe failed'));
            return;
          }
          try {
            resolve(JSON.parse(output) as ProbeResult);
          } catch (error) {
            reject(error);
          }
        });
      });
    } finally {
      await file.close();
    }
  }
}

type ProbeResult = {
  streams?: {
    codec_type?: string;
    duration?: string;
    tags?: Record<string, string>;
  }[];
  format?: { duration?: string; tags?: Record<string, string> };
};

const tagValue = (tags: Record<string, string>, name: string): string => {
  const match = Object.entries(tags).find(
    ([key]) => key.toLowerCase() === name,
  );
  return match?.[1]?.trim() ?? '';
};

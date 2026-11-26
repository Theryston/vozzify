import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import {
  MISSING_PRIVATE_VIDEO_AUDIO,
  PRIVATE_AUDIO_MAX_DURATION_SECONDS,
} from '@vozzify/contracts';
import { z } from 'zod';
import { ZodValidationException } from '../../common/zod/zod-validation.pipe.js';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import { PRIVATE_AUDIO_FORMAT_WHITELIST } from '../../integrations/ffmpeg/private-audio-formats.js';

type AudioMetadata = {
  durationMs: number;
  title: string;
  artist: string;
  hasVideo?: true;
};

export const invalidPrivateAudio = (
  message: string,
  reason?: typeof MISSING_PRIVATE_VIDEO_AUDIO,
) =>
  new ZodValidationException(
    new z.ZodError([
      {
        code: 'custom',
        path: ['audio'],
        message,
        ...(reason && { params: { reason } }),
      },
    ]),
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
    const stream = probe.streams?.find(
      ({ codec_type }) => codec_type === 'audio',
    );
    const videoStreams = probe.streams?.filter(isVideoStream) ?? [];
    const hasVideo = videoStreams.length > 0;
    if (!stream) throw missingAudio(hasVideo);
    const duration = await this.validateDuration(filePath, {
      hasVideo,
      declaredDuration: Math.max(
        Number(probe.format?.duration) || 0,
        ...videoStreams.map((video) => Number(video.duration) || 0),
      ),
    });
    const streamTags = stream.tags ?? {};
    const formatTags = probe.format?.tags ?? {};
    return {
      durationMs: Math.round(duration * 1000),
      title: tagValue(streamTags, 'title') || tagValue(formatTags, 'title'),
      artist: tagValue(streamTags, 'artist') || tagValue(formatTags, 'artist'),
      ...(hasVideo && { hasVideo: true }),
    };
  }

  async extractVideoAudio(filePath: string, outputPath: string): Promise<void> {
    try {
      await this.ffmpeg.convertPrivateAudioFileToWav(
        filePath,
        outputPath,
        PRIVATE_AUDIO_MAX_DURATION_SECONDS,
      );
    } catch {
      throw invalidPrivateAudio('Audio could not be extracted from the video');
    }
  }

  async hash(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  }

  private async validateDuration(
    filePath: string,
    {
      hasVideo,
      declaredDuration,
    }: { hasVideo: boolean; declaredDuration: number },
  ): Promise<number> {
    const limit = PRIVATE_AUDIO_MAX_DURATION_SECONDS;
    if (hasVideo && declaredDuration > limit) throw invalidDuration();
    let duration: number;
    try {
      duration = await (hasVideo
        ? this.ffmpeg.validateVideoFile(filePath, limit)
        : this.ffmpeg.validateAudioFile(filePath, limit));
    } catch {
      throw invalidPrivateAudio(
        'Audio or video could not be decoded within the duration limit',
      );
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration > limit) {
      throw invalidDuration();
    }
    return duration;
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
            '-show_entries',
            'stream=codec_type,duration:stream_disposition=attached_pic:stream_tags=title,artist:format=duration:format_tags=title,artist',
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
  streams?: ProbeStream[];
  format?: { duration?: string; tags?: Record<string, string> };
};

type ProbeStream = {
  codec_type?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
};

const isVideoStream = (stream: ProbeStream): boolean =>
  stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1;

const invalidDuration = () =>
  invalidPrivateAudio(
    'The source must contain decodable audio and be no longer than 30 minutes',
  );

const missingAudio = (hasVideo: boolean) =>
  hasVideo
    ? invalidPrivateAudio(
        'Video must contain an audio track',
        MISSING_PRIVATE_VIDEO_AUDIO,
      )
    : invalidDuration();

const tagValue = (tags: Record<string, string>, name: string): string => {
  const match = Object.entries(tags).find(
    ([key]) => key.toLowerCase() === name,
  );
  return match?.[1]?.trim() ?? '';
};

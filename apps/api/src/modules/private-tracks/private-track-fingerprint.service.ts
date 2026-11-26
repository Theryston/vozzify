import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';

// The retained WAV is stereo 44.1 kHz PCM. A 24 MiB prefix covers the
// fingerprint's first 120 seconds without copying the full private object.
const FINGERPRINT_WAV_RANGE = `bytes=0-${24 * 1024 * 1024 - 1}`;

@Injectable()
export class PrivateTrackFingerprintService {
  constructor(
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegClient,
  ) {}

  async fromMedia(mediaKey: string): Promise<string | null> {
    const directory = await mkdtemp(
      join(tmpdir(), 'vozzify-private-fingerprint-'),
    );
    try {
      const wavPath = join(directory, 'music.wav');
      const wav = await this.storage.getPrivateObject(
        mediaKey,
        FINGERPRINT_WAV_RANGE,
      );
      await pipeline(wav, createWriteStream(wavPath));
      return await this.ffmpeg.fingerprintWav(
        wavPath,
        join(directory, 'fingerprint'),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

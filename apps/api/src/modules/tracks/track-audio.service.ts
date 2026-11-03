import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { AudioDownloadClient } from '../../integrations/audio-download/audio-download.client.js';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import type { StepWait } from './track-processing.job.js';
import {
  type ProcessingForStep,
  TrackProcessingRepository,
} from './track-processing.repository.js';
import { attemptStepCall } from './track-processing-failure.js';
import { DONE, STOPPED, type StepOutcome } from './track-step-outcome.js';

const wavKeyOf = (processing: ProcessingForStep): string =>
  `track-audio/${processing.trackId}/${processing.id}.wav`;

/** Idempotent direct download, file conversion and streamed S3 upload. */
@Injectable()
export class TrackAudioService {
  private readonly logger = new Logger(TrackAudioService.name);

  constructor(
    private readonly downloads: AudioDownloadClient,
    private readonly ffmpeg: FfmpegClient,
    private readonly storage: StorageService,
    private readonly processings: TrackProcessingRepository,
  ) {}

  async run(
    processing: ProcessingForStep,
    // Jobs queued before this migration may still carry a conversion wait.
    _wait: StepWait | undefined,
  ): Promise<StepOutcome> {
    if ((await this.processings.findMusicWavUrl(processing.id)) !== null) {
      return DONE;
    }
    if (await this.storage.objectExists(wavKeyOf(processing))) {
      return this.saveWavUrl(processing);
    }
    if (processing.videoId === null) {
      throw new Error(`Processing ${processing.id} has no video to download`);
    }
    const dir = await mkdtemp(join(tmpdir(), 'vozzify-download-'));
    try {
      await this.store(processing, dir, processing.videoId);
      return await this.saveWavUrl(processing);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async store(
    processing: ProcessingForStep,
    dir: string,
    videoId: string,
  ): Promise<void> {
    const audioPath = join(dir, 'audio.source');
    const wavPath = join(dir, 'music.wav');
    await this.attempt('download the YouTube audio', () =>
      this.downloads.downloadToFile(videoId, audioPath),
    );
    await this.attempt('convert the audio to WAV', () =>
      this.ffmpeg.convertAudioFileToWav(audioPath, wavPath),
    );
    await rm(audioPath);
    await this.storage.putPublicFile({
      key: wavKeyOf(processing),
      filePath: wavPath,
      contentType: 'audio/wav',
    });
  }

  private async saveWavUrl(
    processing: ProcessingForStep,
  ): Promise<StepOutcome> {
    const saved = await this.processings.saveMusicWavUrl(
      processing.id,
      this.storage.publicUrl(wavKeyOf(processing)),
    );
    return saved ? DONE : STOPPED;
  }

  private attempt<T>(action: string, work: () => Promise<T>): Promise<T> {
    return attemptStepCall(this.logger, 'DOWNLOAD_FAILED', action, work);
  }
}

import { Injectable } from '@nestjs/common';
import { AudioDownloadClient } from '../../integrations/audio-download/audio-download.client.js';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../../integrations/note-detection/note-detection.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { privateTrackStagingKey } from './private-track-object-keys.js';

const PRIVATE_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

@Injectable()
export class PrivateTrackProcessingIntegrations {
  constructor(
    readonly ffmpeg: FfmpegClient,
    readonly storage: StorageService,
    readonly detector: NoteDetectionClient,
    readonly audioDownload: AudioDownloadClient,
  ) {}

  async detectorInput(
    userId: string,
    privateTrackId: string,
    musicKey: string,
    attemptId: string,
  ): Promise<NoteDetectionInput> {
    const vocalsKey = privateTrackStagingKey(
      userId,
      privateTrackId,
      attemptId,
      'vocals.wav',
    );
    const pitchCurveKey = privateTrackStagingKey(
      userId,
      privateTrackId,
      attemptId,
      'pitch-curve.bin',
    );
    return {
      processingId: privateTrackId,
      musicUrl: await this.storage.presignPrivateGet({
        key: musicKey,
        expiresInSeconds: PRIVATE_UPLOAD_TTL_SECONDS,
      }),
      vocalsUpload: {
        presignedPutUrl: await this.storage.presignPrivatePut({
          key: vocalsKey,
          contentType: 'audio/wav',
          expiresInSeconds: PRIVATE_UPLOAD_TTL_SECONDS,
        }),
        contentType: 'audio/wav',
        publicUrl: this.storage.privateObjectUrl(vocalsKey),
      },
      pitchCurveUpload: {
        presignedPutUrl: await this.storage.presignPrivatePut({
          key: pitchCurveKey,
          contentType: 'application/octet-stream',
          expiresInSeconds: PRIVATE_UPLOAD_TTL_SECONDS,
        }),
        contentType: 'application/octet-stream',
        publicUrl: this.storage.privateObjectUrl(pitchCurveKey),
      },
    };
  }
}

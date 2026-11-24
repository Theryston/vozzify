import { Injectable } from '@nestjs/common';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import {
  NoteDetectionClient,
  type NoteDetectionInput,
} from '../../integrations/note-detection/note-detection.client.js';
import { StorageService } from '../../integrations/storage/storage.service.js';

const PRIVATE_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

@Injectable()
export class PrivateTrackProcessingIntegrations {
  constructor(
    readonly ffmpeg: FfmpegClient,
    readonly storage: StorageService,
    readonly detector: NoteDetectionClient,
  ) {}

  async detectorInput(
    userId: string,
    privateTrackId: string,
    musicKey: string,
    attemptId: string,
  ): Promise<NoteDetectionInput> {
    const vocalsKey = stagingKey(
      userId,
      privateTrackId,
      attemptId,
      'vocals.wav',
    );
    const pitchCurveKey = stagingKey(
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

function stagingKey(
  userId: string,
  privateTrackId: string,
  attemptId: string,
  filename: string,
): string {
  return `private-tracks/${userId}/${privateTrackId}/staging/${attemptId}/${filename}`;
}

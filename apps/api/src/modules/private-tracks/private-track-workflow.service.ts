import { Injectable, Logger } from '@nestjs/common';
import type {
  PrivateTrack,
  PrivateTrackProcessingState,
} from '@vozzify/contracts';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';
import { PrivateTracksService } from './private-tracks.service.js';

@Injectable()
export class PrivateTrackWorkflowService {
  private readonly logger = new Logger(PrivateTrackWorkflowService.name);

  constructor(
    private readonly tracks: PrivateTracksService,
    private readonly processing: PrivateTrackProcessingService,
  ) {}

  async submit(
    userId: string,
    upload: { path: string; originalname: string },
  ): Promise<PrivateTrack> {
    const track = await this.tracks.submit(userId, upload);
    await this.queueProcessing(userId, track.id);
    return track;
  }

  async retry(
    userId: string,
    privateTrackId: string,
  ): Promise<PrivateTrackProcessingState> {
    const { processing, retryId } = await this.tracks.prepareRetry(
      userId,
      privateTrackId,
    );
    if (retryId) await this.queueProcessing(userId, privateTrackId, retryId);
    return processing;
  }

  async queueProcessing(
    ...args: Parameters<PrivateTrackProcessingService['enqueue']>
  ): Promise<void> {
    const [, privateTrackId] = args;
    try {
      await this.processing.enqueue(...args);
    } catch (error) {
      this.logger.warn(
        `Could not enqueue processing for private Track ${privateTrackId}: ${String(error)}`,
      );
    }
  }
}

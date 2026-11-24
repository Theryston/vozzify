import { Injectable, Logger } from '@nestjs/common';
import type { PrivateTrack } from '@vozzify/contracts';
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
    try {
      await this.processing.enqueue(userId, track.id);
    } catch (error) {
      this.logger.warn(
        `Could not enqueue processing for private Track ${track.id}: ${String(error)}`,
      );
    }
    return track;
  }
}

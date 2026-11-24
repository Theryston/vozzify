import { Injectable } from '@nestjs/common';
import { PrivateTrackProcessingService } from './private-track-processing.service.js';
import { PrivateTracksService } from './private-tracks.service.js';

@Injectable()
export class PrivateTrackWorkflowService {
  constructor(
    private readonly tracks: PrivateTracksService,
    private readonly processing: PrivateTrackProcessingService,
  ) {}

  async submit(userId: string, upload: { path: string; originalname: string }) {
    const track = await this.tracks.submit(userId, upload);
    await this.processing.enqueue(userId, track.id);
    return track;
  }
}

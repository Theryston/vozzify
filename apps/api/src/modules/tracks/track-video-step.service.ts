import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  type ProcessingForStep,
  TrackProcessingRepository,
} from './track-processing.repository.js';
import { type ChosenVideo, TrackVideoService } from './track-video.service.js';
import { TracksRepository } from './tracks.repository.js';

/**
 * The find-video step (ADR 0004): chooses the video of a Processing and saves
 * it on the Processing and on its Track, in one unit. A run that finds a video
 * already chosen (a retry, or a job replayed after its save) keeps that video.
 */
@Injectable()
export class TrackVideoStepService {
  constructor(
    private readonly tracks: TracksRepository,
    private readonly processings: TrackProcessingRepository,
    private readonly videos: TrackVideoService,
  ) {}

  /**
   * @throws {TrackProcessingFailure} when no video can be chosen.
   */
  async run(processing: ProcessingForStep): Promise<void> {
    if (processing.videoId !== null && processing.videoSource !== null) {
      return undefined;
    }
    const track = await this.tracks.findPipelineTrack(processing.trackId);
    if (track === undefined) {
      throw new Error(
        `Track ${processing.trackId} disappeared during its Processing`,
      );
    }
    const finding = await this.videos.findVideo(track);
    await this.save(processing, finding.video);
  }

  /**
   * The video goes on the Processing only while its find-video step is still
   * running, and on the Track only then too: a job that ran late writes nothing.
   */
  @Transactional()
  private async save(
    processing: ProcessingForStep,
    chosen: ChosenVideo,
  ): Promise<void> {
    const saved = await this.processings.saveVideo(
      processing.id,
      'FINDING_VIDEO',
      chosen,
    );
    if (saved) {
      await this.tracks.setYoutubeVideoId(processing.trackId, chosen.videoId);
    }
  }
}

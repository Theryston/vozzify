import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TrackProcessingStep } from '@vozzify/contracts';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackSearchIndexEventRepository } from './track-search-index-event.repository.js';

/** Commits the terminal Processing state with its durable search projection. */
@Injectable()
export class TrackProcessingCompletionService {
  constructor(
    private readonly processings: TrackProcessingRepository,
    private readonly searchIndexEvents: TrackSearchIndexEventRepository,
  ) {}

  @Transactional()
  async complete(
    processingId: string,
    trackId: string,
    lastStep: TrackProcessingStep,
  ): Promise<boolean> {
    const completed = await this.processings.markCompleted(
      processingId,
      lastStep,
    );
    if (!completed) return false;
    await this.searchIndexEvents.enqueueCompletedTrack(trackId);
    return true;
  }
}

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TimedLyricLine } from '../../integrations/elevenlabs/track-lyrics-lines.js';
import { TrackLyricsRepository } from './track-lyrics.repository.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import type { ProcessingRef } from './track-processing-outputs.js';

/**
 * Writes a Track's Timed lyrics on behalf of a Processing's lyrics stage. The
 * Processing's row is locked and must still be in that stage, so a job that
 * ran late writes nothing; the lines and the check share one transaction.
 */
@Injectable()
export class TrackTimedLyricsService {
  constructor(
    private readonly processings: TrackProcessingRepository,
    private readonly lyrics: TrackLyricsRepository,
  ) {}

  /**
   * Replaces the Track's Timed lyrics with these (an empty list clears them).
   * False, with nothing written, when the Processing has moved on.
   */
  @Transactional()
  async replace(
    processing: ProcessingRef,
    lines: readonly TimedLyricLine[],
  ): Promise<boolean> {
    const inStage = await this.processings.lockLyricsStage(processing.id);
    if (!inStage) {
      return false;
    }
    await this.lyrics.replaceTimedLyrics(processing.trackId, lines);
    return true;
  }
}

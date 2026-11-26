import { Injectable, Logger } from '@nestjs/common';
import { type TrackLyrics, trackLyricsSchema } from '@vozzify/contracts';
import { ElevenLabsTranscriptionClient } from '../../integrations/elevenlabs/elevenlabs-transcription.client.js';
import { timedLyricsOf } from '../../integrations/elevenlabs/track-lyrics-lines.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

@Injectable()
export class PrivateTrackLyricsService {
  private readonly logger = new Logger(PrivateTrackLyricsService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly transcription: ElevenLabsTranscriptionClient,
    private readonly tracks: PrivateTracksRepository,
  ) {}

  async finish(
    id: string,
    attemptId: string,
    vocalsKey: string,
    finalAttempt: boolean,
  ): Promise<void> {
    let lyrics: TrackLyrics | null = null;
    try {
      const sourceUrl = await this.storage.presignPrivateGet({
        key: vocalsKey,
        expiresInSeconds: 15 * 60,
      });
      const transcription = await this.transcription.transcribe({ sourceUrl });
      lyrics = trackLyricsSchema.parse({ lines: timedLyricsOf(transcription) });
    } catch (error) {
      if (!finalAttempt) throw error;
      this.logger.warn(
        `Private track ${id} completed without timed lyrics after transcription failed`,
      );
    }
    await this.tracks.completeLyrics(id, attemptId, lyrics);
  }
}

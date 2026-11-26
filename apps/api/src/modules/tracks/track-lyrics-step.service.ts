import { Injectable } from '@nestjs/common';
import { ElevenLabsTranscriptionClient } from '../../integrations/elevenlabs/elevenlabs-transcription.client.js';
import { timedLyricsOf } from '../../integrations/elevenlabs/track-lyrics-lines.js';
import { TrackMp3Service } from './track-mp3.service.js';
import type { ProcessingForStep } from './track-processing.repository.js';
import { DONE, STOPPED, type StepOutcome } from './track-step-outcome.js';
import { TrackTimedLyricsService } from './track-timed-lyrics.service.js';

/**
 * The lyrics step of a Processing (#234): the vocals are stored as MP3, then
 * transcribed with Scribe v2 into the Track's Timed lyrics. No Lyrics guidance
 * is sent: the transcription is the vocals alone. The music MP3 is a job of
 * its own, so its failure never stops the transcription. A failure of this
 * step throws, so the pipeline retries it; on its last attempt the Processing
 * completes without Timed lyrics.
 */
@Injectable()
export class TrackLyricsStepService {
  constructor(
    private readonly mp3s: TrackMp3Service,
    private readonly transcription: ElevenLabsTranscriptionClient,
    private readonly timedLyrics: TrackTimedLyricsService,
  ) {}

  async run(processing: ProcessingForStep): Promise<StepOutcome> {
    // The Track's lines are its latest Processing's: an earlier Processing's
    // lines go as this stage starts, so none survives it, however it ends.
    if (!(await this.timedLyrics.replace(processing, []))) {
      return STOPPED;
    }
    await this.mp3s.queueMusicMp3(processing);
    const vocals = await this.mp3s.storeVocalsMp3(processing);
    const transcribed = await this.transcription.transcribe({ audio: vocals });
    const written = await this.timedLyrics.replace(
      processing,
      timedLyricsOf(transcribed),
    );
    return written ? DONE : STOPPED;
  }
}

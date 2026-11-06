import { Injectable } from '@nestjs/common';
import type {
  BestPracticeScores,
  MostSungArtist,
  PracticeAttempt,
  PracticeAttemptPage,
  SubmitPracticeAttemptBody,
  TrackVocalRange,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { TracksService } from '../tracks/tracks.service.js';
import { toPracticeAttempt } from './attempt-view.js';
import type {
  ArtistGroupRow,
  NewPracticeAttempt,
  VocalRangeGroupRow,
} from './attempts.repository.js';
import { AttemptsRepository } from './attempts.repository.js';
import {
  decodeOwnAttemptCursor,
  nextOwnAttemptCursor,
} from './own-attempt-cursor.js';
import {
  type ArtistGroup,
  deriveMostSungArtist,
  deriveVocalRange,
  VOCAL_RANGE_MIN_ACCURACY,
  type VocalRangeGroup,
} from './profile-chips.js';
import { type MostSungArtistActivity } from './profile-chips-ranking.js';

/** A run must cover this share of the Track's notes to be saved. */
const MIN_ATTEMPT_COVERAGE = 0.9;

const noScores: BestPracticeScores = {
  EASY: null,
  NORMAL: null,
  HARD: null,
};

/** The Vocal range input of the chip rules, from a grouped row. */
const toVocalRangeGroup = (row: VocalRangeGroupRow): VocalRangeGroup => ({
  trackVocalRange:
    row.trackVocalRangeLowest === null || row.trackVocalRangeHighest === null
      ? null
      : {
          lowest: row.trackVocalRangeLowest,
          highest: row.trackVocalRangeHighest,
        },
  transposeSemitones: row.transposeSemitones,
  forwardSkip: row.forwardSkip,
  bleedSuspected: row.bleedSuspected,
  bestAccuracy: row.bestAccuracy,
});

/** The Most sung artist input of the chip rules, from a grouped row. */
const toArtistGroup = (row: ArtistGroupRow): ArtistGroup => ({
  artist: { id: row.artistId, name: row.artistName },
  bleedSuspected: row.bleedSuspected,
  attempts: row.attempts,
  lastAttemptAt: row.lastAttemptAt,
});

/**
 * A signed-in User's saved practice runs. Only valid runs are saved: the
 * scoring already knows the rule (coverage of at least 90%, no forward
 * seek), and the API enforces it again here so no client can write a run
 * the page would never submit.
 */
@Injectable()
export class AttemptsService {
  constructor(
    private readonly attempts: AttemptsRepository,
    private readonly tracks: TracksService,
  ) {}

  /**
   * Saves a run. A legacy Track ID answers `RESOURCE_MOVED` and an unknown
   * one `NOT_FOUND`, as every Track read does; a run that covered under 90%
   * of the notes or skipped forward is refused with `ATTEMPT_REJECTED`.
   */
  async submitAttempt(
    userId: string,
    trackId: string,
    body: SubmitPracticeAttemptBody,
  ): Promise<PracticeAttempt> {
    await this.tracks.assertTrackExists(trackId);
    if (body.forwardSkip) {
      throw new AppException('ATTEMPT_REJECTED', 'The run skipped forward', {
        reason: 'FORWARD_SKIP',
      });
    }
    if (body.coverage < MIN_ATTEMPT_COVERAGE) {
      throw new AppException(
        'ATTEMPT_REJECTED',
        'The run covered under 90% of the notes',
        { reason: 'COVERAGE' },
      );
    }
    const attempt: NewPracticeAttempt = {
      userId,
      trackId,
      difficulty: body.difficulty,
      octaveMode: body.octaveMode,
      transposeSemitones: body.transposeSemitones,
      speed: body.speed,
      accuracy: body.accuracy,
      coverage: body.coverage,
      forwardSkip: body.forwardSkip,
      bleedSuspected: body.bleedSuspected,
      startedAt: new Date(body.startedAt),
      endedAt: new Date(body.endedAt),
      ...(body.viewId === undefined ? {} : { viewId: body.viewId }),
    };
    return toPracticeAttempt(await this.attempts.insert(attempt));
  }

  /** How many saved runs of the User count as sung (not bleed-suspected). */
  countSung(userId: string): Promise<number> {
    return this.attempts.countSung(userId);
  }

  /** The User's best accuracy per difficulty on a Track, for the title row. */
  async bestScores(
    userId: string,
    trackId: string,
  ): Promise<BestPracticeScores> {
    await this.tracks.assertTrackExists(trackId);
    const rows = await this.attempts.bestAccuracies(userId, trackId);
    const scores: BestPracticeScores = { ...noScores };
    for (const row of rows) {
      scores[row.difficulty] = row.accuracy;
    }
    return scores;
  }

  /**
   * The two Profile chips a User's attempts decide, each `null` when no
   * attempt qualifies (see `profile-chips.ts` for the rules).
   */
  async profileChips(userId: string): Promise<{
    vocalRange: TrackVocalRange | null;
    mostSungArtist: MostSungArtist | null;
  }> {
    const [vocalRange, artistGroups] = await Promise.all([
      this.vocalRange(userId),
      this.attempts.listArtistGroups(userId),
    ]);
    return {
      vocalRange,
      mostSungArtist: deriveMostSungArtist(artistGroups.map(toArtistGroup)),
    };
  }

  /** Every valid Artist run, kept separate for per-run taste decay. */
  async mostSungArtistActivities(
    userId: string,
  ): Promise<MostSungArtistActivity[]> {
    const rows = await this.attempts.listArtistActivities(userId);
    return rows
      .filter((row) => !row.bleedSuspected)
      .map((row) => ({
        artist: { id: row.artistId, name: row.artistName },
        lastAttemptAt: row.createdAt,
      }));
  }

  /** The derived range for home recommendations, using Profile's exact rules. */
  async vocalRange(userId: string): Promise<TrackVocalRange | null> {
    const groups = await this.attempts.listVocalRangeGroups(userId);
    return deriveVocalRange(groups.map(toVocalRangeGroup));
  }

  async vocalRangeEvidenceCount(userId: string): Promise<number> {
    const groups = await this.attempts.listVocalRangeEvidenceGroups(userId);
    const qualifying = groups.filter(
      (group) =>
        group.trackVocalRangeLowest !== null &&
        group.trackVocalRangeHighest !== null &&
        group.bestAccuracy >= VOCAL_RANGE_MIN_ACCURACY &&
        !group.forwardSkip &&
        !group.bleedSuspected,
    );
    return new Set(
      qualifying.map((group) => `${group.trackId}:${group.transposeSemitones}`),
    ).size;
  }

  /** The signed-in User's own attempts, newest first. */
  async listOwn(
    userId: string,
    query: { cursor?: string; limit: number },
  ): Promise<PracticeAttemptPage> {
    const rows = await this.attempts.listOwn({
      userId,
      after: query.cursor ? decodeOwnAttemptCursor(query.cursor) : undefined,
      // One more than asked tells whether another page follows.
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toPracticeAttempt),
      nextCursor: nextOwnAttemptCursor(page.at(-1), rows.length > query.limit),
    };
  }
}

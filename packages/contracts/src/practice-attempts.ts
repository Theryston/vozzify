import { z } from 'zod';

import { cursorPageSchema, cursorPaginationQuerySchema } from './pagination.js';
import { trackHeaderSchema } from './tracks.js';

// A signed-in User's saved practice runs (`POST /v1/tracks/:trackId/attempts`)
// and their own history (`GET /v1/me/attempts`).

/** How strict the pitch matching of an attempt was. */
export const practiceDifficultySchema = z.enum(['EASY', 'NORMAL', 'HARD']);

export type PracticeDifficulty = z.infer<typeof practiceDifficultySchema>;

/** Whether the attempt counted other octaves as hits (`ANY`) or not (`EXACT`). */
export const octaveModeSchema = z.enum(['ANY', 'EXACT']);

export type OctaveMode = z.infer<typeof octaveModeSchema>;

/** The speeds the dock offers, the only ones an attempt may report. */
export const PRACTICE_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

export type PracticeSpeed = (typeof PRACTICE_SPEEDS)[number];

const isPracticeSpeed = (speed: number): speed is PracticeSpeed =>
  (PRACTICE_SPEEDS as readonly number[]).includes(speed);

export const practiceSpeedSchema = z
  .number()
  .refine(isPracticeSpeed, 'The speed is not one the dock offers');

/**
 * `POST /v1/tracks/:trackId/attempts`. The run the page scored: what shaped
 * it (difficulty, octave mode, transposition, speed), how it went (accuracy,
 * coverage ratio, whether the User skipped forward) and whether the music may
 * have leaked into the mic (`bleedSuspected`), with the wall-clock window the
 * run covered.
 */
export const submitPracticeAttemptBodySchema = z.object({
  difficulty: practiceDifficultySchema,
  octaveMode: octaveModeSchema,
  transposeSemitones: z.number().int().min(-24).max(24),
  speed: practiceSpeedSchema,
  /** Hit notes divided by judged notes, from 0 to 1. */
  accuracy: z.number().min(0).max(1),
  /** Judged notes divided by the Track's notes, from 0 to 1. */
  coverage: z.number().min(0).max(1),
  forwardSkip: z.boolean(),
  bleedSuspected: z.boolean(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  /** The Track page view whose practice produced this run. */
  viewId: z.string().min(1).max(128).optional(),
});

export type SubmitPracticeAttemptBody = z.infer<
  typeof submitPracticeAttemptBodySchema
>;

/** Private practice has no public Track view to attribute the attempt to. */
export const submitPrivatePracticeAttemptBodySchema =
  submitPracticeAttemptBodySchema.omit({ viewId: true }).strict();
export type SubmitPrivatePracticeAttemptBody = z.infer<
  typeof submitPrivatePracticeAttemptBodySchema
>;

/** A saved attempt, as the history reads it. */
export const practiceAttemptSchema = submitPracticeAttemptBodySchema
  .omit({ viewId: true })
  .extend({
    id: z.string().min(1).max(128),
    trackId: z.string().min(1).max(128),
    createdAt: z.iso.datetime({ offset: true }),
    isPrivate: z.literal(true).optional(),
  });

export type PracticeAttempt = z.infer<typeof practiceAttemptSchema>;

/** `GET /v1/me/attempts`: the signed-in User's own attempts, newest first. */
export const listOwnAttemptsQuerySchema = cursorPaginationQuerySchema;

export type ListOwnAttemptsQuery = z.infer<typeof listOwnAttemptsQuerySchema>;

export const practiceAttemptPageSchema = cursorPageSchema(
  practiceAttemptSchema,
);

export type PracticeAttemptPage = z.infer<typeof practiceAttemptPageSchema>;

/**
 * A saved attempt in a User's public practice history, with the Track it was
 * sung on (`GET /v1/users/:username/attempts`). The bleed flag stays on the
 * attempt, so a visitor sees which runs were suspected of leaking the music.
 */
export const practiceAttemptHistoryItemSchema = practiceAttemptSchema.extend({
  track: trackHeaderSchema,
});

export type PracticeAttemptHistoryItem = z.infer<
  typeof practiceAttemptHistoryItemSchema
>;

/** `GET /v1/users/:username/attempts`: the User's history, newest first. */
export const listUserAttemptsQuerySchema = cursorPaginationQuerySchema.extend({
  /** Opts into private attempts when the session owns the Profile. */
  includePrivate: z.literal('true').optional(),
});

export type ListUserAttemptsQuery = z.infer<typeof listUserAttemptsQuerySchema>;

export const practiceAttemptHistoryPageSchema = cursorPageSchema(
  practiceAttemptHistoryItemSchema,
);

export type PracticeAttemptHistoryPage = z.infer<
  typeof practiceAttemptHistoryPageSchema
>;

import {
  type TrackProcessingStep,
  trackProcessingStepSchema,
} from '@vozzify/contracts';
import { z } from 'zod';

// The queue of a Track's Processing (ADR 0004): each step is a job that loads
// its Processing, does its step, persists and enqueues the next one. The cover
// is a job of its own, so it never holds a step back.

export const TRACK_PROCESSING_QUEUE = 'track-processing';
export const RUN_STEP_JOB = 'run-step';
export const STORE_COVER_JOB = 'store-cover';

// A step that waits (a RapidAPI conversion) is checked again by a delayed run
// of the same step. `round` numbers the checks, from 1, and `state` is what the
// step needs to check again (its own schema parses it).
const stepWaitSchema = z.object({
  round: z.number().int().min(1),
  state: z.unknown(),
});

export type StepWait = z.infer<typeof stepWaitSchema>;

export const runStepJobSchema = z.object({
  processingId: z.string().min(1).max(128),
  step: trackProcessingStepSchema,
  /** Set on a re-check of a waiting step; absent on the step's first run. */
  wait: stepWaitSchema.optional(),
});

export type RunStepJob = z.infer<typeof runStepJobSchema>;

export const storeCoverJobSchema = z.object({
  trackId: z.string().min(1).max(128),
  /** The Processing whose video step queued the cover (it keys the job). */
  processingId: z.string().min(1).max(128),
});

export type StoreCoverJob = z.infer<typeof storeCoverJobSchema>;

/**
 * Job IDs make a repeated enqueue a no-op while the first job is kept. Both
 * are keyed by the Processing, so a later Processing of the same Track (a
 * retry) gets its own jobs.
 */
export const stepJobId = (processingId: string, step: TrackProcessingStep) =>
  `step-${processingId}-${step}`;

export const coverJobId = (processingId: string) => `cover-${processingId}`;

/** The job of one re-check of a waiting step; keyed by its round, so each check is queued once. */
export const waitJobId = (
  processingId: string,
  step: TrackProcessingStep,
  round: number,
) => `wait-${processingId}-${step}-${round}`;

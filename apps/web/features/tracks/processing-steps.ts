import {
  TRACK_PROCESSING_STEPS,
  type TrackProcessingStatus,
  type TrackProcessingStep,
} from '@vozzify/contracts';

/** Where one step of a Processing stands, as the step list shows it. */
export type StepState = 'done' | 'current' | 'pending' | 'failed';

export type StepView = { step: TrackProcessingStep; state: StepState };

/**
 * The bar's percentage once each step starts. The bar eases to it with CSS, so
 * these fixed values are the progress the page knows for certain.
 */
const PERCENT_WHEN_STARTED: Record<TrackProcessingStep, number> = {
  FINDING_VIDEO: 10,
  DOWNLOADING_AUDIO: 30,
  EXTRACTING_VOCALS: 50,
  DETECTING_NOTES: 75,
  EXTRACTING_LYRICS: 90,
};

/**
 * The time constant of the creep, in milliseconds: after this long the bar has
 * closed 63% of the gap to the next step. The steps report no progress, so the
 * value is a guess from the durations the legacy steps took (about 25 s to
 * download, 50 s to separate the vocals, 39 s for the notes, 36 s for the
 * lyrics), rounded to the middle of that range.
 */
const CREEP_TIME_CONSTANT_MS = 40_000;

/**
 * The bar's target for a Processing: nothing while queued, everything once
 * completed, and the start of the step it is on (or stopped at) otherwise.
 */
export function progressPercent(
  status: TrackProcessingStatus,
  resumeFrom: TrackProcessingStep | null,
): number {
  if (status === 'COMPLETED') return 100;
  if (status === 'QUEUED') return 0;
  if (status === 'FAILED') {
    return resumeFrom === null ? 0 : PERCENT_WHEN_STARTED[resumeFrom];
  }
  return PERCENT_WHEN_STARTED[status];
}

/**
 * Where a running Processing's bar creeps to: the start of the next step, or
 * 100 after the last one. Null when the bar holds still (completed or failed).
 */
function creepCeiling(status: TrackProcessingStatus): number | null {
  if (status === 'COMPLETED' || status === 'FAILED') return null;
  if (status === 'QUEUED') return PERCENT_WHEN_STARTED.FINDING_VIDEO;
  const index = TRACK_PROCESSING_STEPS.indexOf(status);
  const next = TRACK_PROCESSING_STEPS[index + 1];
  return next === undefined ? 100 : PERCENT_WHEN_STARTED[next];
}

/**
 * The bar's percentage `elapsedMs` after the Processing reached its status.
 * Nothing reports progress inside a step, so the bar starts at the step's value
 * and creeps toward the next one: fast at first, then ever more slowly. Whole
 * percents only, and never the next step's value, so the bar only jumps when
 * the status really changes. A failed Processing holds where it stopped; a
 * completed one is at 100.
 */
export function displayedPercent(
  status: TrackProcessingStatus,
  resumeFrom: TrackProcessingStep | null,
  elapsedMs: number,
): number {
  const base = progressPercent(status, resumeFrom);
  const ceiling = creepCeiling(status);
  if (ceiling === null) return base;
  const share = 1 - Math.exp(-Math.max(0, elapsedMs) / CREEP_TIME_CONSTANT_MS);
  return Math.min(Math.floor(base + (ceiling - base) * share), ceiling - 1);
}

/**
 * How far the steps have got: the steps before `doneBefore` are done, and the
 * one at `active` (if any) is in the given state.
 */
type Position = {
  doneBefore: number;
  active?: { index: number; state: 'current' | 'failed' };
};

function positionOf(
  status: TrackProcessingStatus,
  resumeFrom: TrackProcessingStep | null,
  steps: readonly TrackProcessingStep[],
): Position {
  if (status === 'COMPLETED') return { doneBefore: steps.length };
  if (status === 'QUEUED') return { doneBefore: 0 };
  const step = status === 'FAILED' ? resumeFrom : status;
  const index = step === null ? -1 : steps.indexOf(step);
  if (index < 0) return { doneBefore: 0 };
  return {
    doneBefore: index,
    active: { index, state: status === 'FAILED' ? 'failed' : 'current' },
  };
}

function stateOf(index: number, position: Position): StepState {
  if (index < position.doneBefore) return 'done';
  if (position.active?.index === index) return position.active.state;
  return 'pending';
}

/**
 * Every step of the Processing with its state, in run order. A failed
 * Processing marks the step it stopped at (the one a retry resumes); without
 * that step known, the list shows every step as waiting.
 */
export function stepStates(
  status: TrackProcessingStatus,
  resumeFrom: TrackProcessingStep | null,
  steps: readonly TrackProcessingStep[] = TRACK_PROCESSING_STEPS,
): StepView[] {
  const position = positionOf(status, resumeFrom, steps);
  return steps.map((step, index) => ({
    step,
    state: stateOf(index, position),
  }));
}

/** The step a Processing is on, counted from 1, out of every step. */
export type StepPosition = { number: number; total: number };

/**
 * The step a running Processing is on, or the one a failed Processing stopped
 * at, counted from 1. Null while queued, once completed, and for a failure
 * whose step is unknown: there is no step to name then.
 */
export function stepPosition(
  status: TrackProcessingStatus,
  resumeFrom: TrackProcessingStep | null,
  steps: readonly TrackProcessingStep[] = TRACK_PROCESSING_STEPS,
): StepPosition | null {
  const { active } = positionOf(status, resumeFrom, steps);
  if (active === undefined) return null;
  return { number: active.index + 1, total: steps.length };
}

/**
 * How long each step usually takes, in milliseconds: the durations the legacy
 * steps took (see `CREEP_TIME_CONSTANT_MS`). Finding the video was not timed
 * there; it is one search, so a few seconds is assumed.
 */
const EXPECTED_STEP_MS: Record<TrackProcessingStep, number> = {
  FINDING_VIDEO: 5_000,
  DOWNLOADING_AUDIO: 25_000,
  EXTRACTING_VOCALS: 50_000,
  DETECTING_NOTES: 39_000,
  EXTRACTING_LYRICS: 36_000,
};

const MINUTE_MS = 60_000;

function isStep(status: TrackProcessingStatus): status is TrackProcessingStep {
  return (TRACK_PROCESSING_STEPS as readonly string[]).includes(status);
}

/**
 * About how many whole minutes a running Processing has left, `elapsedMs`
 * after it reached its step: what the step usually has left (never below
 * zero once it overruns) plus the usual time of every later step. Null when
 * nothing runs (queued, completed or failed), since a queue wait is unknown.
 */
export function remainingMinutes(
  status: TrackProcessingStatus,
  elapsedMs: number,
): number | null {
  if (!isStep(status)) return null;
  const index = TRACK_PROCESSING_STEPS.indexOf(status);
  const later = TRACK_PROCESSING_STEPS.slice(index + 1).reduce(
    (sum, step) => sum + EXPECTED_STEP_MS[step],
    0,
  );
  const current = Math.max(
    0,
    EXPECTED_STEP_MS[status] - Math.max(0, elapsedMs),
  );
  return Math.round((current + later) / MINUTE_MS);
}

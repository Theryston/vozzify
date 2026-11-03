import type { TrackProcessingFailureCode } from '@vozzify/contracts';

// What a step leaves for the pipeline (pure). A step is done and the pipeline
// moves on; it has to be checked again later (a long wait, such as note detection, is a delayed re-check job, never a blocking loop); it ends the
// Processing now with a failure that retrying would not change; or the
// Processing moved on while the step ran and the step stops without advancing.

/** The step is finished: the pipeline queues the next one, or completes. */
export type DoneOutcome = { kind: 'done' };

/** The step must run again after `delayMs`, with `state` as its re-check's state. */
export type WaitOutcome = { kind: 'wait'; delayMs: number; state: unknown };

/** The step ends the Processing now with this failure; no BullMQ retry follows. */
export type FailedOutcome = {
  kind: 'failed';
  code: TrackProcessingFailureCode;
};

/** The Processing moved on while the step ran: its row is not this step's to change. */
export type StoppedOutcome = { kind: 'stopped' };

export type StepOutcome =
  | DoneOutcome
  | WaitOutcome
  | FailedOutcome
  | StoppedOutcome;

export const DONE: DoneOutcome = { kind: 'done' };

export const STOPPED: StoppedOutcome = { kind: 'stopped' };

export const waitFor = (delayMs: number, state: unknown): WaitOutcome => ({
  kind: 'wait',
  delayMs,
  state,
});

export const failedWith = (
  code: TrackProcessingFailureCode,
): FailedOutcome => ({
  kind: 'failed',
  code,
});

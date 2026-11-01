import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  cacheTags,
  type TrackProcessingFailureCode,
  type TrackProcessingStep,
} from '@vozzify/contracts';
import { type Queue, UnrecoverableError } from 'bullmq';
import { catalogPageTags } from '../../integrations/web-revalidation/catalog-page-tags.js';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import {
  dueStatusesOf,
  firstPipelineStep,
  isOptionalStep,
  isPipelineStep,
  isStepDue,
  nextPipelineStep,
  type PipelineStepName,
  resumeStepOf,
} from './track-pipeline-steps.js';
import {
  coverJobId,
  RUN_STEP_JOB,
  type RunStepJob,
  STORE_COVER_JOB,
  type StepWait,
  type StoreCoverJob,
  stepJobId,
  TRACK_PROCESSING_QUEUE,
  waitJobId,
} from './track-processing.job.js';
import {
  type ProcessingForStep,
  TrackProcessingRepository,
} from './track-processing.repository.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import {
  messageOf,
  TrackProcessingFailure,
} from './track-processing-failure.js';
import { isRetryableFailureCode } from './track-processing-view.js';
import {
  DONE,
  type StepOutcome,
  type WaitOutcome,
} from './track-step-outcome.js';
import { TrackStepsService } from './track-steps.service.js';

/** What one step does with its Processing; `wait` is set on a re-check. */
type StepHandler = (
  processing: ProcessingForStep,
  wait: StepWait | undefined,
) => Promise<StepOutcome>;

/**
 * Runs a Track's Processing (ADR 0004). Each step job loads its Processing,
 * does its step, persists the result and enqueues the next step; the last step
 * completes the Processing and revalidates the Track's pages. A step that
 * fails for good marks the Processing `FAILED` with its code, and so does the
 * last attempt of a step that keeps failing.
 */
@Injectable()
export class TrackPipelineService {
  private readonly logger = new Logger(TrackPipelineService.name);

  @Inject(TrackProcessingCompletionService)
  private completion: TrackProcessingCompletionService | undefined = undefined;

  /**
   * What each step of the pipeline does. Typed on the step list, so a step
   * added there without its handler here does not compile.
   */
  private readonly handlers: Record<PipelineStepName, StepHandler> = {
    FINDING_VIDEO: (processing) => this.findVideo(processing),
    DOWNLOADING_AUDIO: (processing, wait) =>
      this.steps.downloadAudio(processing, wait),
    EXTRACTING_VOCALS: (processing, wait) =>
      this.steps.extractVocals(processing, wait),
    DETECTING_NOTES: (processing, wait) =>
      this.steps.detectNotes(processing, wait),
    EXTRACTING_LYRICS: (processing) => this.steps.extractLyrics(processing),
  };

  constructor(
    @InjectQueue(TRACK_PROCESSING_QUEUE)
    private readonly queue: Queue<RunStepJob | StoreCoverJob>,
    private readonly processings: TrackProcessingRepository,
    private readonly steps: TrackStepsService,
    private readonly revalidation: WebRevalidationService,
  ) {}

  /**
   * Queues the first step of a Track's latest Processing when that Processing
   * has not started: the request of a new Track, or a later request for a
   * Track whose first start failed. A queued retry starts at the step its row
   * names (`resumeFrom`). Job IDs are keyed by the Processing, so queuing it
   * again while the first job is kept does nothing.
   */
  async startIfQueued(trackId: string): Promise<void> {
    const latest = await this.processings.findLatestProcessing(trackId);
    if (latest?.status !== 'QUEUED') {
      return;
    }
    // A retry's row names the step it starts at; a first run starts at the first step.
    await this.enqueueStep(latest.id, latest.resumeFrom ?? firstPipelineStep());
  }

  /**
   * A step job. A Processing that is terminal, or already past this step, has
   * nothing due, so a replayed job changes nothing. A job that runs late is
   * stopped by the guarded write that starts the step.
   */
  async runStep(job: RunStepJob, finalAttempt: boolean): Promise<void> {
    if (!isPipelineStep(job.step)) {
      throw new UnrecoverableError(
        `The ${job.step} step is not part of this build`,
      );
    }
    const processing = await this.processings.findProcessing(job.processingId);
    if (processing === undefined || !isStepDue(processing.status, job.step)) {
      return;
    }
    const started = await this.processings.markStepStarted(
      processing.id,
      job.step,
      dueStatusesOf(job.step),
    );
    if (!started) {
      return;
    }
    try {
      const outcome = await this.runHandler(
        processing,
        job.step,
        job.wait,
        finalAttempt,
      );
      await this.conclude(processing, job.step, job.wait?.round ?? 0, outcome);
    } catch (error) {
      return this.failStep(processing, job.step, error, finalAttempt);
    }
  }

  /**
   * Chooses the video, then queues the cover with the artwork the search
   * found, so the cover job does not search again. The cover job does not hold
   * the next step back.
   */
  private async findVideo(processing: ProcessingForStep): Promise<StepOutcome> {
    const artworkUrl = await this.steps.findVideo(processing);
    await this.enqueueCover({
      trackId: processing.trackId,
      processingId: processing.id,
      artworkUrl,
    });
    return DONE;
  }

  /**
   * Acts on what a step left: the next step, a re-check, a final failure, or
   * nothing when the Processing moved on (the step does not advance it).
   */
  private async conclude(
    processing: ProcessingForStep,
    step: PipelineStepName,
    round: number,
    outcome: StepOutcome,
  ): Promise<void> {
    if (outcome.kind === 'wait') {
      await this.enqueueWait(processing.id, step, round, outcome);
      return;
    }
    if (outcome.kind === 'failed') {
      await this.markStepFailed(processing, step, outcome.code);
      return;
    }
    if (outcome.kind === 'done') {
      await this.advance(processing, step);
    }
  }

  /**
   * Queues the next check of a waiting step after its delay. The check's round
   * follows the round that queued it (0 for the step's first run), and its job
   * ID is keyed by that round.
   */
  private async enqueueWait(
    processingId: string,
    step: PipelineStepName,
    round: number,
    wait: WaitOutcome,
  ): Promise<void> {
    const nextRound = round + 1;
    await this.queue.add(
      RUN_STEP_JOB,
      {
        processingId,
        step,
        wait: { round: nextRound, state: wait.state },
      },
      {
        jobId: waitJobId(processingId, step, nextRound),
        delay: wait.delayMs,
      },
    );
  }

  /**
   * Queues the step after this one, or completes the Processing when this was
   * the last. Inside the step's try block, so a failure here is retried (and
   * replays the step, which is idempotent) rather than left half-done.
   */
  private advance(processing: ProcessingForStep, step: PipelineStepName) {
    const next = nextPipelineStep(step);
    return next === undefined
      ? this.complete(processing, step)
      : this.enqueueStep(processing.id, next);
  }

  /**
   * Runs the step's handler. An optional step (see `isOptionalStep`) that fails
   * on its last attempt does not hold the Processing back: the failure is
   * logged, and the step counts as done without its output. Its earlier attempts
   * throw, so BullMQ retries them. Only the handler is covered: what follows the
   * step (the completion) fails the Processing like any other step's.
   */
  private async runHandler(
    processing: ProcessingForStep,
    step: PipelineStepName,
    wait: StepWait | undefined,
    finalAttempt: boolean,
  ): Promise<StepOutcome> {
    try {
      return await this.handlers[step](processing, wait);
    } catch (error) {
      if (!finalAttempt || !isOptionalStep(step)) {
        throw error;
      }
      this.logger.warn(
        `Processing ${processing.id} completes without its ${step} output: ${messageOf(error)}`,
      );
      return DONE;
    }
  }

  /**
   * A failure that repeating cannot fix (`VIDEO_NOT_FOUND`, `TOO_LONG`) ends the
   * Processing now. Any other failure is retried by BullMQ with backoff, and
   * ends the Processing with its code (or `INTERNAL`) on the last attempt.
   */
  private async failStep(
    processing: ProcessingForStep,
    step: TrackProcessingStep,
    error: unknown,
    finalAttempt: boolean,
  ): Promise<void> {
    const code =
      error instanceof TrackProcessingFailure ? error.code : undefined;
    const isFinal = code !== undefined && !isRetryableFailureCode(code);
    if (!isFinal && !finalAttempt) {
      throw error;
    }
    const failureCode = code ?? 'INTERNAL';
    this.logger.warn(
      `Processing ${processing.id} failed at ${step} with ${failureCode}: ${messageOf(error)}`,
    );
    await this.markStepFailed(processing, step, failureCode);
  }

  /**
   * Ends the Processing as FAILED at this step with its code. A retry resumes
   * at the step the failure belongs to (see `resumeStepOf`).
   */
  private markStepFailed(
    processing: ProcessingForStep,
    step: TrackProcessingStep,
    code: TrackProcessingFailureCode,
  ): Promise<boolean> {
    return this.processings.markFailed(processing.id, dueStatusesOf(step), {
      code,
      resumeFrom: resumeStepOf(step),
    });
  }

  /**
   * The last step is done: the Track's pages refresh, then the Processing
   * completes. The refresh comes first, so if it fails the replayed job still
   * finds the Processing unfinished and refreshes again.
   */
  private async complete(
    processing: ProcessingForStep,
    lastStep: PipelineStepName,
  ): Promise<void> {
    // The Artist and Album pages list the Track now that it is complete.
    const catalog = await this.processings.findCatalogIds(processing.trackId);
    await this.revalidation.revalidate([
      cacheTags.track(processing.trackId),
      cacheTags.trackNotes(processing.trackId),
      cacheTags.trackLyrics(processing.trackId),
      cacheTags.tracks,
      ...catalogPageTags(catalog),
    ]);
    // A completed Track joins the Tracks, Artists and Albums sitemaps, which
    // share one tag: it drops their cached pages, so the next crawl sees it.
    await this.revalidation.revalidate([cacheTags.sitemap]);
    if (this.completion === undefined) {
      throw new Error('Track completion service is unavailable');
    }
    await this.completion.complete(processing.id, processing.trackId, lastStep);
  }

  private async enqueueStep(
    processingId: string,
    step: TrackProcessingStep,
  ): Promise<void> {
    await this.queue.add(
      RUN_STEP_JOB,
      { processingId, step },
      { jobId: stepJobId(processingId, step) },
    );
  }

  private async enqueueCover(job: StoreCoverJob): Promise<void> {
    await this.queue.add(STORE_COVER_JOB, job, {
      jobId: coverJobId(job.processingId),
    });
  }
}

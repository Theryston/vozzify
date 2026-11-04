import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { TrackMigrationService } from '../tracks/track-migration.service.js';
import { LegacyProcessingAdmissionService } from './legacy-processing-admission.service.js';
import {
  type BacklogReport,
  LegacyProcessingBacklogRepository,
} from './legacy-processing-backlog.repository.js';

const POLL_INTERVAL_MS = 5_000;

/** Drains only durable, prepared migration attempts, one bounded batch at a time. */
@Injectable()
export class LegacyProcessingBacklogService {
  private readonly logger = new Logger(LegacyProcessingBacklogService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly backlog: LegacyProcessingBacklogRepository,
    private readonly admission: LegacyProcessingAdmissionService,
    private readonly tracks: TrackMigrationService,
  ) {}

  async drain(): Promise<BacklogReport> {
    let previous: BacklogReport | undefined;
    for (;;) {
      const report = await this.runCycle();
      if (!this.sameReport(previous, report)) {
        this.logger.log(report);
        previous = report;
      }
      if (!(await this.backlog.hasPendingWork())) {
        this.logger.log({ preparedBacklogDrained: true, ...report });
        return report;
      }
      await this.waitForNextPoll();
    }
  }

  /** Performs one durable admission/recovery pass; useful after an operator restart. */
  async runCycle(): Promise<BacklogReport> {
    await this.admission.admit(this.env.LEGACY_PROCESSING_CONCURRENCY ?? 2);
    await this.startAdmittedQueued();
    return this.backlog.report();
  }

  private async startAdmittedQueued(): Promise<void> {
    const queued = await this.backlog.unstartedQueued();
    for (const work of queued) {
      try {
        const result = await this.tracks.start(work.trackId, work.processingId);
        if (result === 'started')
          await this.backlog.markStarted(work.processingId);
      } catch {
        // The reservation remains durable and this attempt is retried next poll.
        this.logger.error(
          'Could not enqueue an admitted legacy Processing; it remains reserved and will be retried.',
        );
      }
    }
  }

  private sameReport(
    previous: BacklogReport | undefined,
    current: BacklogReport,
  ): boolean {
    return (
      previous?.queued === current.queued &&
      previous.admitted === current.admitted &&
      previous.running === current.running &&
      previous.completed === current.completed &&
      previous.failed === current.failed
    );
  }

  private waitForNextPoll(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

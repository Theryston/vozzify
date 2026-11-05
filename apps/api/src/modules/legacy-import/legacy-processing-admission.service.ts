import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { ENV, type Env } from '../../config/env.js';
import {
  type BacklogWork,
  LegacyProcessingBacklogRepository,
} from './legacy-processing-backlog.repository.js';

/** Owns the transaction boundary for durable migration slot reservations. */
@Injectable()
export class LegacyProcessingAdmissionService {
  constructor(
    private readonly repository: LegacyProcessingBacklogRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Transactional()
  admit(concurrency: number): Promise<BacklogWork[]> {
    return this.repository.admit(concurrency);
  }

  @Transactional()
  reserveStarted(processingId: string): Promise<boolean> {
    return this.repository.reserveStarted(
      processingId,
      this.env.LEGACY_PROCESSING_CONCURRENCY ?? 2,
    );
  }

  @Transactional()
  markStarted(processingId: string): Promise<void> {
    return this.repository.markStarted(processingId);
  }
}

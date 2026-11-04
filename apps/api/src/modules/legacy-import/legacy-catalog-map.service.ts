import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  IMPORT_METADATA_JOB,
  type ImportMetadataJob,
  metadataJobId,
  TRACK_METADATA_QUEUE,
} from '../../queue/track-metadata.job.js';
import type { LegacyCatalogMapInputs } from './legacy-catalog-map-input.service.js';
import { LegacyCatalogMapInputService } from './legacy-catalog-map-input.service.js';
import { LegacyCatalogMapReconciler } from './legacy-catalog-map-reconciler.js';

export type LegacyCatalogMapPlan = LegacyCatalogMapInputs['plans'][number];

/** Reconciles frozen legacy identities against completed metadata imports. */
@Injectable()
export class LegacyCatalogMapService {
  constructor(
    private readonly inputs: LegacyCatalogMapInputService,
    private readonly reconciler: LegacyCatalogMapReconciler,
    @InjectQueue(TRACK_METADATA_QUEUE)
    private readonly metadataQueue: Queue<ImportMetadataJob>,
  ) {}

  async reconcile() {
    const inputs = await this.inputs.load();
    await this.resumeMetadata(inputs.plans);
    return this.reconciler.reconcile(inputs);
  }

  private async resumeMetadata(plans: LegacyCatalogMapPlan[]): Promise<void> {
    for (const plan of plans) {
      if (
        plan.status === 'planned' &&
        plan.trackId &&
        plan.processingId &&
        plan.metadataStatus !== 'completed'
      ) {
        await this.ensureMetadataJob(plan.trackId, plan.processingId);
      }
    }
  }

  private async ensureMetadataJob(
    trackId: string,
    processingId: string,
  ): Promise<void> {
    const id = metadataJobId(processingId);
    const existing = await this.metadataQueue.getJob(id);
    const state = await existing?.getState();
    if (isActiveMetadataState(state)) return;
    if (existing) await existing.remove();
    await this.metadataQueue.add(
      IMPORT_METADATA_JOB,
      { trackId },
      { jobId: id },
    );
  }
}

const isActiveMetadataState = (state: string | undefined): boolean =>
  state === 'waiting' ||
  state === 'active' ||
  state === 'delayed' ||
  state === 'waiting-children' ||
  state === 'paused';

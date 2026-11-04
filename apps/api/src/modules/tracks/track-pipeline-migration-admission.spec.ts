import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { LegacyProcessingAdmissionService } from '../legacy-import/legacy-processing-admission.service.js';
import { TrackMigrationRepository } from './track-migration.repository.js';
import { TrackPipelineService } from './track-pipeline.service.js';
import { TRACK_PROCESSING_QUEUE } from './track-processing.job.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackProcessingCompletionService } from './track-processing-completion.service.js';
import { TrackStepsService } from './track-steps.service.js';

describe('TrackPipelineService migration admission', () => {
  it('reserves before enqueue and acknowledges only after enqueue succeeds', async () => {
    const events: string[] = [];
    const admission = {
      reserveStarted: vi.fn(async () => {
        events.push('reserve');
        return true;
      }),
      markStarted: vi.fn(async () => events.push('acknowledge')),
    };
    const module = await Test.createTestingModule({
      providers: [
        TrackPipelineService,
        {
          provide: getQueueToken(TRACK_PROCESSING_QUEUE),
          useValue: {
            add: async () => {
              events.push('enqueue');
            },
          },
        },
        {
          provide: TrackProcessingRepository,
          useValue: {
            findLatestProcessing: async () => ({
              id: 'processing-a',
              status: 'QUEUED',
              resumeFrom: null,
            }),
          },
        },
        {
          provide: TrackMigrationRepository,
          useValue: { isMigration: async () => true },
        },
        { provide: LegacyProcessingAdmissionService, useValue: admission },
        { provide: TrackProcessingCompletionService, useValue: {} },
        { provide: TrackStepsService, useValue: {} },
        { provide: WebRevalidationService, useValue: {} },
      ],
    }).compile();
    try {
      await module.get(TrackPipelineService).startIfQueued('track-a');
      expect(events).toEqual(['reserve', 'enqueue', 'acknowledge']);
    } finally {
      await module.close();
    }
  });

  it('leaves the admission retryable when the initial enqueue fails', async () => {
    const admission = {
      reserveStarted: vi.fn(async () => true),
      markStarted: vi.fn(async () => undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        TrackPipelineService,
        {
          provide: getQueueToken(TRACK_PROCESSING_QUEUE),
          useValue: {
            add: async () => Promise.reject(new Error('unavailable')),
          },
        },
        {
          provide: TrackProcessingRepository,
          useValue: {
            findLatestProcessing: async () => ({
              id: 'processing-a',
              status: 'QUEUED',
              resumeFrom: null,
            }),
          },
        },
        {
          provide: TrackMigrationRepository,
          useValue: { isMigration: async () => true },
        },
        { provide: LegacyProcessingAdmissionService, useValue: admission },
        { provide: TrackProcessingCompletionService, useValue: {} },
        { provide: TrackStepsService, useValue: {} },
        { provide: WebRevalidationService, useValue: {} },
      ],
    }).compile();
    try {
      await expect(
        module.get(TrackPipelineService).startIfQueued('track-a'),
      ).rejects.toThrow('unavailable');
      expect(admission.reserveStarted).toHaveBeenCalledWith('processing-a');
      expect(admission.markStarted).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('does not enqueue a manual migration start without an available slot', async () => {
    const admission = {
      reserveStarted: vi.fn(async () => false),
      markStarted: vi.fn(async () => undefined),
    };
    const queue = { add: vi.fn(async () => undefined) };
    const module = await Test.createTestingModule({
      providers: [
        TrackPipelineService,
        { provide: getQueueToken(TRACK_PROCESSING_QUEUE), useValue: queue },
        {
          provide: TrackProcessingRepository,
          useValue: {
            findLatestProcessing: async () => ({
              id: 'processing-b',
              status: 'QUEUED',
              resumeFrom: null,
            }),
          },
        },
        {
          provide: TrackMigrationRepository,
          useValue: { isMigration: async () => true },
        },
        { provide: LegacyProcessingAdmissionService, useValue: admission },
        { provide: TrackProcessingCompletionService, useValue: {} },
        { provide: TrackStepsService, useValue: {} },
        { provide: WebRevalidationService, useValue: {} },
      ],
    }).compile();
    try {
      await expect(
        module.get(TrackPipelineService).startIfQueued('track-b'),
      ).resolves.toBe('capacity-full');
      expect(admission.reserveStarted).toHaveBeenCalledWith('processing-b');
      expect(queue.add).not.toHaveBeenCalled();
      expect(admission.markStarted).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });
});

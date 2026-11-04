import { describe, expect, it, vi } from 'vitest';
import { metadataJobId } from '../../queue/track-metadata.job.js';
import { LegacyCatalogMapService } from './legacy-catalog-map.service.js';
import { LegacyCatalogMapInputService } from './legacy-catalog-map-input.service.js';
import { LegacyCatalogMapReconciler } from './legacy-catalog-map-reconciler.js';

const plan = (metadataStatus: string) => ({
  status: 'planned',
  recordingMbid: 'recording-1',
  trackId: 'track-1',
  processingId: 'processing-1',
  metadataStatus,
  source: {},
});

const makeService = (metadataStatus: string, existingState?: string) => {
  const inputs = {
    load: vi.fn().mockResolvedValue({
      plans: [plan(metadataStatus)],
      artists: [],
      albums: [],
    }),
  };
  const reconciler = {
    reconcile: vi.fn().mockResolvedValue({
      artists: { mapped: 0, unresolved: 0, pending: 1 },
      albums: { mapped: 0, unresolved: 0, pending: 0 },
    }),
  };
  const remove = vi.fn().mockResolvedValue(undefined);
  const queue = {
    getJob: vi
      .fn()
      .mockResolvedValue(
        existingState
          ? { getState: async () => existingState, remove }
          : undefined,
      ),
    add: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new LegacyCatalogMapService(
      inputs as unknown as LegacyCatalogMapInputService,
      reconciler as unknown as LegacyCatalogMapReconciler,
      queue as never,
    ),
    inputs,
    reconciler,
    queue,
    remove,
  };
};

describe('LegacyCatalogMapService', () => {
  it('requeues a missing metadata job and returns its pending report', async () => {
    const { service, queue, reconciler } = makeService('pending');

    await expect(service.reconcile()).resolves.toMatchObject({
      artists: { pending: 1 },
      albums: { pending: 0 },
    });
    expect(reconciler.reconcile).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      'import-metadata',
      { trackId: 'track-1' },
      { jobId: metadataJobId('processing-1') },
    );
  });

  it('removes and requeues a failed job for the normal metadata worker', async () => {
    const { service, queue, remove } = makeService('failed', 'failed');

    await service.reconcile();

    expect(remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it('does not duplicate metadata work already waiting or active', async () => {
    const { service, queue } = makeService('pending', 'active');

    await service.reconcile();

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not requeue completed metadata after its queue record expires', async () => {
    const { service, queue } = makeService('completed');

    await service.reconcile();

    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

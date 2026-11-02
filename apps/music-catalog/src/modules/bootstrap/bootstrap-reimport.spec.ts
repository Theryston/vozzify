import type { BootstrapRepository } from './bootstrap.repository.js';
import {
  BootstrapService,
  type ReimportStatusSource,
} from './bootstrap.service.js';

const setup = (
  state: Awaited<ReturnType<BootstrapRepository['getState']>>,
  replication?: {
    report: () => Promise<{
      replicationSequence: number | null;
      pendingOutbox: number;
    }>;
  },
  reimport?: {
    status?: ReimportStatusSource;
    cutover?: { adoptIfSwitched: () => Promise<void> };
  },
) => {
  const repository = { getState: vi.fn(async () => state) };
  const service = new BootstrapService(
    repository as unknown as BootstrapRepository,
    'full',
    replication,
    reimport,
  );
  return { service, repository };
};

describe('BootstrapService getStatus with reimport', () => {
  it('merges the stall with the reimport phase and progress', async () => {
    const cutover = { adoptIfSwitched: vi.fn(async () => undefined) };
    const { service } = setup(
      { phase: 'ready', dataset: 'full' },
      {
        report: async () => ({
          replicationSequence: 188_660,
          pendingOutbox: 3,
          replicationStalled: { reason: 'schema-change', detail: 'stalled' },
        }),
      },
      {
        status: {
          reportReimport: async () => ({
            phase: 'indexing' as const,
            progressPct: 42,
          }),
        },
        cutover,
      },
    );

    await expect(service.getStatus()).resolves.toEqual({
      phase: 'ready',
      dataset: 'full',
      replicationSequence: 188_660,
      pendingOutbox: 3,
      replicationStalled: { reason: 'schema-change', detail: 'stalled' },
      reimport: { phase: 'indexing', progressPct: 42 },
    });
    expect(cutover.adoptIfSwitched).toHaveBeenCalledTimes(1);
  });

  it('answers the old shape without a reimport', async () => {
    const { service } = setup(
      { phase: 'ready', dataset: 'full' },
      {
        report: async () => ({ replicationSequence: null, pendingOutbox: 0 }),
      },
    );

    await expect(service.getStatus()).resolves.toEqual({
      phase: 'ready',
      dataset: 'full',
      replicationSequence: null,
      pendingOutbox: 0,
    });
  });

  it('stays ready while a reimport runs', async () => {
    const reportReimport = vi.fn(async () => ({
      phase: 'restoring' as const,
    }));
    const { service } = setup({ phase: 'ready', dataset: 'full' }, undefined, {
      status: { reportReimport },
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      phase: 'ready',
      reimport: { phase: 'restoring' },
    });
    expect(reportReimport).toHaveBeenCalledTimes(1);

    await expect(service.assertReady()).resolves.toBeUndefined();
    expect(reportReimport).toHaveBeenCalledTimes(1);
  });
});

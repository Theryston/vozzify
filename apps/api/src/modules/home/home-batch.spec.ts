import { runBoundedBatch } from './home-batch.js';

describe('runBoundedBatch', () => {
  it('does not start another batch until the current batch finishes', async () => {
    const started: number[] = [];
    await runBoundedBatch([0, 1, 2, 3, 4], 2, async (item) => {
      started.push(item);
      await Promise.resolve();
    });
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops starting batches after a failure', async () => {
    const started: number[] = [];
    await expect(
      runBoundedBatch([0, 1, 2], 2, async (item) => {
        started.push(item);
        if (item === 1) throw new Error('refresh failed');
      }),
    ).rejects.toThrow('refresh failed');
    expect(started).toEqual([0, 1]);
  });
});

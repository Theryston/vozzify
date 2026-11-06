/** Runs bounded batches so the pending work does not grow with catalog size. */
export const runBoundedBatch = async <T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }
  for (let start = 0; start < items.length; start += concurrency) {
    const results = await Promise.allSettled(
      items.slice(start, start + concurrency).map(task),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }
};

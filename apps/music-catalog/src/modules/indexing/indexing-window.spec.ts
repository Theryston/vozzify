import type { RecordingDocument } from '../../lib/recordings-index.js';
import type { DocumentBatch } from '../recording/recording-document.service.js';
import { runIndexingWindow } from './indexing-window.js';

const batch = (id: number, size = 1): DocumentBatch => ({
  lastRecordingId: id + size - 1,
  documents: Array.from({ length: size }, (_, offset) => ({
    mbid: `recording-${id + offset}`,
    title: `Title ${id + offset}`,
    artistCredit: 'Artist',
    artistAliases: [],
    releaseTitles: [],
    workTitles: [],
    genres: [],
    disambiguation: '',
  })),
});

const sourceBatch = async (afterId: number, size: number) =>
  batch(afterId + 1, size);

const pendingTask = () => {
  const resolvers = {
    resolve: (): void => undefined,
    reject: (_error: Error): void => undefined,
  };
  const promise = new Promise<void>((resolve, reject) => {
    resolvers.resolve = resolve;
    resolvers.reject = reject;
  });
  return { promise, ...resolvers };
};

const setup = (batchSize = 1) => {
  const controller = new AbortController();
  const tasks = Array.from({ length: 2 }, pendingTask);
  const documents = {
    findBatch: vi.fn(
      async (
        afterId: number,
        _size: number,
      ): Promise<DocumentBatch | undefined> => batch(afterId + 1),
    ),
  };
  let sent = 0;
  const index = {
    upsert: vi.fn((_documents: RecordingDocument[]) => {
      const task = tasks[sent++];
      if (task === undefined) throw new Error('Too many pending batches');
      return task.promise;
    }),
  };
  const confirm = vi.fn(async (_batch: DocumentBatch) => undefined);
  const run = () =>
    runIndexingWindow({
      afterId: 0,
      batchSize,
      signal: controller.signal,
      documents,
      index,
      confirm,
    });
  return { controller, tasks, documents, index, confirm, run };
};

describe('runIndexingWindow', () => {
  it('combines bounded source reads into two pending 50,000-document tasks', async () => {
    const { run, tasks, documents, index, confirm } = setup(50_000);
    documents.findBatch.mockImplementation(sourceBatch);
    const running = run();
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    expect(documents.findBatch).toHaveBeenCalledTimes(10);
    expect(documents.findBatch).toHaveBeenNthCalledWith(1, 0, 10_000);
    expect(documents.findBatch).toHaveBeenNthCalledWith(6, 50_000, 10_000);
    expect(documents.findBatch).toHaveBeenLastCalledWith(90_000, 10_000);
    expect(index.upsert.mock.calls.map(([items]) => items.length)).toEqual([
      50_000, 50_000,
    ]);
    expect(confirm).not.toHaveBeenCalled();
    for (const task of tasks) task.resolve();
    await expect(running).resolves.toEqual({
      afterId: 100_000,
      exhausted: false,
    });
    expect(confirm.mock.calls.map(([item]) => item.lastRecordingId)).toEqual([
      50_000, 100_000,
    ]);
  });

  it('limits the final source read to the remaining task capacity', async () => {
    const { run, tasks, documents, index } = setup(12_500);
    documents.findBatch.mockImplementation(sourceBatch);
    const running = run();
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    expect(documents.findBatch.mock.calls).toEqual([
      [0, 10_000],
      [10_000, 2_500],
      [12_500, 10_000],
      [22_500, 2_500],
    ]);
    for (const task of tasks) task.resolve();
    await expect(running).resolves.toEqual({
      afterId: 25_000,
      exhausted: false,
    });
  });

  it('submits the final partial task and confirms it before reporting exhaustion', async () => {
    const { run, tasks, documents, index, confirm } = setup(50_000);
    documents.findBatch
      .mockResolvedValueOnce(batch(1, 10_000))
      .mockResolvedValueOnce(batch(10_001, 10_000))
      .mockResolvedValueOnce(batch(20_001, 7))
      .mockResolvedValueOnce(undefined);
    const running = run();
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(1));
    expect(index.upsert.mock.calls[0]?.[0]).toHaveLength(20_007);
    expect(confirm).not.toHaveBeenCalled();
    tasks[0]?.resolve();
    await expect(running).resolves.toEqual({
      afterId: 20_007,
      exhausted: true,
    });
    expect(confirm.mock.calls.map(([item]) => item.lastRecordingId)).toEqual([
      20_007,
    ]);
  });

  it('discards a partially assembled task on abort without checkpointing it', async () => {
    const { run, documents, controller, index, confirm } = setup(50_000);
    documents.findBatch
      .mockResolvedValueOnce(batch(1, 10_000))
      .mockImplementationOnce(async () => {
        controller.abort();
        return batch(10_001, 10_000);
      });
    await expect(run()).resolves.toEqual({ afterId: 0, exhausted: false });
    expect(documents.findBatch).toHaveBeenCalledTimes(2);
    expect(index.upsert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('drains the sent task when a later task fails during assembly', async () => {
    const { run, tasks, documents, index, confirm } = setup(50_000);
    const failure = new Error('source read failed during task assembly');
    documents.findBatch.mockImplementation(async (afterId, size) => {
      if (afterId === 60_000) throw failure;
      return batch(afterId + 1, size);
    });
    const running = run();
    const rejected = expect(running).rejects.toBe(failure);
    await vi.waitFor(() =>
      expect(documents.findBatch).toHaveBeenCalledTimes(7),
    );
    expect(index.upsert).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    tasks[0]?.resolve();
    await rejected;
    expect(confirm.mock.calls.map(([item]) => item.lastRecordingId)).toEqual([
      50_000,
    ]);
  });

  it('does not confirm a failed second task after confirming the first', async () => {
    const { run, tasks, index, confirm } = setup();
    const failure = new Error('second task failed');
    const running = run();
    const rejected = expect(running).rejects.toBe(failure);
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    tasks[1]?.reject(failure);
    tasks[0]?.resolve();
    await rejected;
    expect(confirm).toHaveBeenCalledExactlyOnceWith(batch(1));
  });

  it('stops source reads when a sent task fails during the next task assembly', async () => {
    const { run, tasks, documents, index, confirm } = setup(50_000);
    const failure = new Error('first task failed during assembly');
    const loading = pendingTask();
    documents.findBatch.mockImplementation(async (afterId, size) => {
      const prepared = await sourceBatch(afterId, size);
      if (afterId === 60_000) await loading.promise;
      return prepared;
    });
    const running = run();
    const rejected = expect(running).rejects.toBe(failure);
    await vi.waitFor(() =>
      expect(documents.findBatch).toHaveBeenCalledTimes(7),
    );
    tasks[0]?.reject(failure);
    loading.resolve();
    await rejected;
    expect(documents.findBatch).toHaveBeenCalledTimes(7);
    expect(index.upsert).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('stops submission if an earlier task fails while the next batch loads', async () => {
    const { run, tasks, index, documents, confirm } = setup();
    const failure = new Error('earlier task failed');
    const loading = pendingTask();
    documents.findBatch
      .mockResolvedValueOnce(batch(1))
      .mockImplementationOnce(async () => {
        await loading.promise;
        return batch(2);
      });
    const running = run();
    const rejected = expect(running).rejects.toBe(failure);
    await vi.waitFor(() =>
      expect(documents.findBatch).toHaveBeenCalledTimes(2),
    );
    tasks[0]?.reject(failure);
    loading.resolve();
    await rejected;
    expect(index.upsert).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('overlaps preparation and indexing, with at most two pending batches', async () => {
    const { run, tasks, index, documents, confirm } = setup();
    const running = run();
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    expect(documents.findBatch.mock.calls).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(confirm).not.toHaveBeenCalled();
    for (const task of tasks) task.resolve();
    await expect(running).resolves.toEqual({ afterId: 2, exhausted: false });
    expect(confirm.mock.calls.map(([item]) => item.lastRecordingId)).toEqual([
      1, 2,
    ]);
  });

  it('confirms in source order even when later tasks finish first', async () => {
    const { run, tasks, index, confirm } = setup();
    const running = run();
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    tasks[1]?.resolve();
    await Promise.resolve();
    expect(confirm).not.toHaveBeenCalled();
    tasks[0]?.resolve();
    await running;
    expect(confirm.mock.calls.map(([item]) => item.lastRecordingId)).toEqual([
      1, 2,
    ]);
  });

  it('never checkpoints beyond a failed batch and drains later writes before rejecting', async () => {
    const { run, tasks, index, confirm } = setup();
    const failure = new Error('batch failed');
    const running = run();
    const rejected = expect(running).rejects.toBe(failure);
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    tasks[0]?.reject(failure);
    await Promise.resolve();
    expect(settled).toBe(false);
    tasks[1]?.resolve();
    await rejected;
    expect(confirm).not.toHaveBeenCalled();
  });

  it('drains sent tasks and confirms them after a source read fails', async () => {
    const { run, tasks, documents, index, confirm } = setup();
    const failure = new Error('read failed');
    documents.findBatch
      .mockResolvedValueOnce(batch(1))
      .mockRejectedValueOnce(failure);
    const running = run();
    const rejected = expect(running).rejects.toBe(failure);
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(1));
    tasks[0]?.resolve();
    await rejected;
    expect(confirm).toHaveBeenCalledExactlyOnceWith(batch(1));
    expect(index.upsert).toHaveBeenCalledTimes(1);
  });

  it('drains writes after a checkpoint fails without confirming later batches', async () => {
    const { run, tasks, index, confirm } = setup();
    const failure = new Error('checkpoint failed');
    confirm.mockRejectedValueOnce(failure);
    const running = run();
    const rejected = expect(running).rejects.toBe(failure);
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    for (const task of tasks) task.resolve();
    await rejected;
    expect(confirm).toHaveBeenCalledExactlyOnceWith(batch(1));
  });

  it('stops admitting batches on abort and waits for those already sent', async () => {
    const { run, tasks, index, controller, confirm } = setup();
    const running = run();
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(2));
    controller.abort();
    for (const task of tasks) task.resolve();
    await running;
    expect(index.upsert).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('does not submit a batch loaded after cancellation', async () => {
    const { run, documents, index, controller } = setup();
    documents.findBatch.mockImplementationOnce(async () => {
      controller.abort();
      return batch(1);
    });
    await expect(run()).resolves.toEqual({ afterId: 0, exhausted: false });
    expect(index.upsert).not.toHaveBeenCalled();
  });

  it('starts no source read if already aborted', async () => {
    const { run, documents, controller } = setup();
    controller.abort();
    await expect(run()).resolves.toEqual({ afterId: 0, exhausted: false });
    expect(documents.findBatch).not.toHaveBeenCalled();
  });

  it('reports the end of the source only after confirming pending batches', async () => {
    const { run, tasks, index, documents, confirm } = setup();
    documents.findBatch
      .mockResolvedValueOnce(batch(1))
      .mockResolvedValueOnce(undefined);
    const running = run();
    await vi.waitFor(() => expect(index.upsert).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
    tasks[0]?.resolve();
    await expect(running).resolves.toEqual({ afterId: 1, exhausted: true });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(batch(1));
  });
});

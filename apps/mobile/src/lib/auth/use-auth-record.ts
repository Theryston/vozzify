import { useCallback, useRef, useState } from 'react';
import { type StoredAuth, writeAuth } from './auth-storage';

export function useAuthRecord() {
  const [record, setRecord] = useState<StoredAuth>({});
  const current = useRef<StoredAuth>({});
  // Serialize persistence so a late or cancelled request cannot overwrite a newer flow.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const replace = useCallback((next: StoredAuth) => {
    current.current = next;
    setRecord(next);
  }, []);

  const update = useCallback(
    (transform: (previous: StoredAuth) => StoredAuth, signal?: AbortSignal) => {
      const write = queue.current.then(async () => {
        if (signal?.aborted) return false;
        const previous = current.current;
        const next = transform(previous);
        if (next === previous) return false;
        await writeAuth(next);
        if (signal?.aborted) {
          await writeAuth(previous);
          return false;
        }
        replace(next);
        return true;
      });
      queue.current = write.catch(() => undefined);
      return write;
    },
    [replace],
  );

  return { record, current, replace, update };
}

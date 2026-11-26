import { useRef, useState } from 'react';
import type { z } from 'zod';
import { authErrorKey } from './auth-errors';

export function useAuthSubmit<T extends z.ZodType>(
  schema: T,
  perform: (values: z.output<T>) => Promise<void>,
  onError?: (key: ReturnType<typeof authErrorKey>) => void,
) {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReturnType<typeof authErrorKey>>();
  const [invalid, setInvalid] = useState<Set<PropertyKey>>(new Set());

  async function submit(values: z.input<T>) {
    if (active.current) return;
    const result = schema.safeParse(values);
    setError(undefined);
    setInvalid(
      new Set(result.error?.issues.map((issue) => issue.path[0] ?? '')),
    );
    if (!result.success) return;
    active.current = true;
    setPending(true);
    try {
      await perform(result.data);
    } catch (failure) {
      const key = authErrorKey(failure);
      setError(key);
      onError?.(key);
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const clear = (field: PropertyKey) => {
    setInvalid((previous) => {
      if (!previous.has(field)) return previous;
      const remaining = new Set(previous);
      remaining.delete(field);
      return remaining;
    });
    setError(undefined);
  };

  return { submit, pending, error, invalid, clear };
}

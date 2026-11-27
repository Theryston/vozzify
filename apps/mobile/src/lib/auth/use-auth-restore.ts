import type { AuthSessionUser } from '@vozzify/contracts';
import { useEffect, useRef, useState } from 'react';
import { restoreAuthSession } from './auth-api';
import { readAuth } from './auth-storage';
import type { useAuthRecord } from './use-auth-record';

type ActiveSession = { user: AuthSessionUser; token: string };
type Storage = Pick<ReturnType<typeof useAuthRecord>, 'replace' | 'update'>;
const restoreTimeoutMs = 5_000;

async function restore({ replace, update }: Storage, signal: AbortSignal) {
  const stored = await readAuth();
  if (signal.aborted) return null;
  replace(stored);
  if (!stored.token) return null;

  const { data, token } = await restoreAuthSession(stored.token, signal);
  if (signal.aborted) return null;
  const nextToken = data ? (token ?? stored.token) : undefined;
  if (nextToken !== stored.token) {
    await update((previous) => ({ ...previous, token: nextToken }), signal);
  }
  return data && nextToken ? { user: data.user, token: nextToken } : null;
}

export function useAuthRestore({ replace, update }: Storage) {
  const pending = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [session, setSession] = useState<ActiveSession | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    const finish = (restored: ActiveSession | null) => {
      if (pending.current !== controller) return;
      pending.current = null;
      setSession(restored);
      setStatus('ready');
    };
    const useGuest = () => {
      if (pending.current !== controller) return;
      controller.abort();
      // Keep the saved token on disk for the next launch after a transient failure.
      replace({});
      finish(null);
    };
    const timeout = setTimeout(useGuest, restoreTimeoutMs);
    void restore({ replace, update }, controller.signal)
      .then(finish, useGuest)
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      pending.current = null;
      controller.abort();
    };
  }, [replace, update]);

  function interruptRestore() {
    if (!pending.current) return;
    pending.current.abort();
    pending.current = null;
    setStatus('ready');
  }

  return { status, session, setSession, interruptRestore };
}

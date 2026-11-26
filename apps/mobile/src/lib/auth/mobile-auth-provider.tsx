import type { AuthSessionUser, SetUsernameBody } from '@vozzify/contracts';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { MobileHttpError } from '../api/mobile-api-error';
import { restoreAuthSession, saveUsername } from './auth-api';
import type { AuthContinuation } from './auth-continuation';
import { readAuth, type StoredAuth, writeAuth } from './auth-storage';
import { useAuthRecord } from './use-auth-record';
import { recordCodeSent } from './use-code-cooldown';

type RestoredAuth = {
  stored: StoredAuth;
  user: AuthSessionUser | null;
};

type AuthStatus = 'loading' | 'ready' | 'error';

async function restore(): Promise<RestoredAuth> {
  const stored = await readAuth();
  if (!stored.token) return { stored, user: null };
  const { data, token } = await restoreAuthSession(stored.token);
  const nextToken = data ? (token ?? stored.token) : undefined;
  const updated = { ...stored, token: nextToken };
  if (nextToken !== stored.token) await writeAuth(updated);
  return { stored: updated, user: data?.user ?? null };
}

function useRestoreAuth(replaceRecord: (record: StoredAuth) => void) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  useEffect(() => {
    if (status !== 'loading') return;
    let active = true;
    void restore().then(
      (result) => {
        if (!active) return;
        replaceRecord(result.stored);
        setUser(result.user);
        setStatus('ready');
      },
      () => {
        if (active) setStatus('error');
      },
    );
    return () => {
      active = false;
    };
  }, [replaceRecord, status]);

  return { status, user, setUser, retry: () => setStatus('loading') };
}

function useUsernameSelection(
  storage: ReturnType<typeof useAuthRecord>,
  setUser: ReturnType<typeof useRestoreAuth>['setUser'],
) {
  return async (body: SetUsernameBody, signal: AbortSignal) => {
    const { token } = storage.current.current;
    if (!token) return;
    try {
      const nextUser = await saveUsername(body, token, signal);
      if (!signal.aborted) {
        setUser(
          (current) => current && { ...current, username: nextUser.username },
        );
      }
    } catch (error) {
      if (!(error instanceof MobileHttpError) || error.statusCode !== 401)
        throw error;
      await storage.update(({ continuation }) => ({ continuation }), signal);
      if (!signal.aborted) setUser(null);
    }
  };
}

function clearOnboarding(previous: StoredAuth): StoredAuth {
  const { token, verification, continuation } = previous;
  return verification || continuation ? { token } : previous;
}

function useAuthOperations() {
  const storage = useAuthRecord();
  const { status, user, setUser, retry } = useRestoreAuth(storage.replace);
  const chooseUsername = useUsernameSelection(storage, setUser);
  const { update, record } = storage;

  async function beginVerification(
    verification: NonNullable<StoredAuth['verification']>,
    continuation: AuthContinuation,
    signal: AbortSignal,
  ) {
    const saved = await update(
      (previous) => ({ ...previous, verification, continuation }),
      signal,
    );
    if (saved && verification.email) {
      recordCodeSent(
        verification.email,
        'email-verification',
        verification.sentAt,
      );
    }
    return saved;
  }

  async function completeAuth(
    session: { user: AuthSessionUser; token: string },
    continuation: AuthContinuation,
    signal: AbortSignal,
  ) {
    const saved = await update(
      () => ({ token: session.token, continuation }),
      signal,
    );
    if (saved) setUser(session.user);
  }

  return {
    status,
    user,
    retry,
    ...record,
    beginVerification,
    completeAuth,
    chooseUsername,
    cancelOnboarding: () => update(clearOnboarding),
    rememberContinuation: (
      continuation: AuthContinuation,
      signal: AbortSignal,
    ) =>
      update(
        (previous) =>
          previous.continuation ? previous : { ...previous, continuation },
        signal,
      ),
    consumeContinuation: () => consumeContinuation(update),
  };
}

async function consumeContinuation(
  update: ReturnType<typeof useAuthRecord>['update'],
) {
  let continuation: AuthContinuation | undefined;
  try {
    await update((previous) => {
      const { continuation: pending, ...next } = previous;
      continuation = pending;
      return pending ? next : previous;
    });
    return continuation;
  } catch {
    return undefined;
  }
}

const MobileAuthContext = createContext<ReturnType<
  typeof useAuthOperations
> | null>(null);

export function MobileAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthOperations();
  return (
    <MobileAuthContext.Provider value={auth}>
      {children}
    </MobileAuthContext.Provider>
  );
}

export function useMobileAuth() {
  const auth = useContext(MobileAuthContext);
  if (!auth) throw new Error('MobileAuthProvider is missing');
  return auth;
}

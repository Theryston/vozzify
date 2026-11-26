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

type ActiveSession = { user: AuthSessionUser; token: string };

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
  const [session, setSession] = useState<ActiveSession | null>(null);
  useEffect(() => {
    if (status !== 'loading') return;
    let active = true;
    void restore().then(
      (result) => {
        if (!active) return;
        replaceRecord(result.stored);
        setSession(
          result.user && result.stored.token
            ? { user: result.user, token: result.stored.token }
            : null,
        );
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

  return { status, session, setSession, retry: () => setStatus('loading') };
}

function useUsernameSelection(
  storage: ReturnType<typeof useAuthRecord>,
  setSession: ReturnType<typeof useRestoreAuth>['setSession'],
) {
  return async (body: SetUsernameBody, signal: AbortSignal) => {
    const { token } = storage.current.current;
    if (!token) return;
    try {
      const nextUser = await saveUsername(body, token, signal);
      if (!signal.aborted) {
        setSession((current) =>
          current?.token === token
            ? {
                ...current,
                user: { ...current.user, username: nextUser.username },
              }
            : current,
        );
      }
    } catch (error) {
      if (!(error instanceof MobileHttpError) || error.statusCode !== 401)
        throw error;
      await storage.update(
        (current) =>
          current.token === token
            ? { continuation: current.continuation }
            : current,
        signal,
      );
      if (!signal.aborted) {
        setSession((current) => (current?.token === token ? null : current));
      }
    }
  };
}

function clearOnboarding(previous: StoredAuth): StoredAuth {
  const { token, verification, continuation, passwordReset } = previous;
  return verification || continuation || passwordReset ? { token } : previous;
}

function afterPasswordReset(
  previous: StoredAuth,
  email: string,
  continuation: AuthContinuation,
): StoredAuth {
  const pendingEmail = previous.verification?.email?.toLowerCase();
  return {
    ...previous,
    verification:
      pendingEmail === email.toLowerCase() ? undefined : previous.verification,
    passwordReset: continuation,
  };
}

function createBeginVerification(
  update: ReturnType<typeof useAuthRecord>['update'],
) {
  return async (
    verification: NonNullable<StoredAuth['verification']>,
    continuation: AuthContinuation,
    signal: AbortSignal,
  ) => {
    const saved = await update(
      (previous) => ({
        ...previous,
        verification,
        continuation,
        passwordReset: undefined,
      }),
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
  };
}

function useAuthOperations() {
  const storage = useAuthRecord();
  const { status, session, setSession, retry } = useRestoreAuth(
    storage.replace,
  );
  const chooseUsername = useUsernameSelection(storage, setSession);
  const { update, record } = storage;

  async function completeAuth(
    nextSession: ActiveSession,
    continuation: AuthContinuation,
    signal: AbortSignal,
  ) {
    const saved = await update(
      () => ({ token: nextSession.token, continuation }),
      signal,
    );
    if (saved) setSession(nextSession);
  }

  return {
    status,
    retry,
    ...record,
    user: session?.user ?? null,
    token: session?.token,
    finishPasswordReset: (
      email: string,
      continuation: AuthContinuation,
      signal: AbortSignal,
    ) =>
      update(
        (previous) => afterPasswordReset(previous, email, continuation),
        signal,
      ),
    beginVerification: createBeginVerification(update),
    completeAuth,
    chooseUsername,
    cancelOnboarding: () => update(clearOnboarding),
    rememberContinuation: (
      continuation: AuthContinuation,
      signal: AbortSignal,
    ) => rememberContinuation(update, continuation, signal),
    consumeContinuation: () => consumeContinuation(update),
  };
}

function rememberContinuation(
  update: ReturnType<typeof useAuthRecord>['update'],
  continuation: AuthContinuation,
  signal: AbortSignal,
) {
  return update(
    (previous) =>
      previous.continuation ? previous : { ...previous, continuation },
    signal,
  );
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

import type { AuthSessionUser, SetUsernameBody } from '@vozzify/contracts';
import { createContext, type ReactNode, useContext } from 'react';
import { MobileHttpError } from '../api/mobile-api-error';
import { saveUsername } from './auth-api';
import type { AuthContinuation } from './auth-continuation';
import type { StoredAuth } from './auth-storage';
import { useAuthRecord } from './use-auth-record';
import { useAuthRestore } from './use-auth-restore';
import { recordCodeSent } from './use-code-cooldown';

function useUsernameSelection(
  storage: ReturnType<typeof useAuthRecord>,
  setSession: ReturnType<typeof useAuthRestore>['setSession'],
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

function recordVerificationSent(verification: StoredAuth['verification']) {
  if (verification?.email) {
    recordCodeSent(
      verification.email,
      'email-verification',
      verification.sentAt,
    );
  }
}

type CompletedAuth = {
  user: AuthSessionUser;
  token: string;
  verificationSentAt?: number;
};

function verificationForSession({ user, verificationSentAt }: CompletedAuth) {
  if (user.emailVerified || verificationSentAt === undefined) return undefined;
  return { email: user.email, sentAt: verificationSentAt };
}

function retainVerification(
  user: AuthSessionUser,
  verification: StoredAuth['verification'],
) {
  if (user.emailVerified) return undefined;
  return verification?.email?.toLowerCase() === user.email.toLowerCase()
    ? verification
    : undefined;
}

function useCompleteAuth(
  update: ReturnType<typeof useAuthRecord>['update'],
  setSession: ReturnType<typeof useAuthRestore>['setSession'],
) {
  return async (
    session: CompletedAuth,
    continuation: AuthContinuation,
    signal: AbortSignal,
  ) => {
    const { token, user } = session;
    const issued = verificationForSession(session);
    const saved = await update(
      ({ verification }) => ({
        token,
        continuation,
        verification: issued ?? retainVerification(user, verification),
      }),
      signal,
    );
    if (saved) {
      recordVerificationSent(issued);
      setSession({ user, token });
    }
  };
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
  token: string | undefined,
) {
  return async (
    verification: NonNullable<StoredAuth['verification']>,
    continuation: AuthContinuation,
    signal: AbortSignal,
  ) => {
    const saved = await update(
      (previous) => ({
        ...previous,
        token,
        verification,
        continuation,
        passwordReset: undefined,
      }),
      signal,
    );
    if (saved) recordVerificationSent(verification);
    return saved;
  };
}

function useAuthOperations() {
  const storage = useAuthRecord();
  const { status, session, setSession, interruptRestore } =
    useAuthRestore(storage);
  const chooseUsername = useUsernameSelection(storage, setSession);
  const { record, update } = storage;
  const updateInteractively: typeof update = (transform, signal) => {
    if (signal?.aborted) return Promise.resolve(false);
    interruptRestore();
    return update(transform, signal);
  };
  const completeAuth = useCompleteAuth(updateInteractively, setSession);

  return {
    status,
    ...record,
    user: session?.user ?? null,
    token: session?.token,
    finishPasswordReset: (
      email: string,
      continuation: AuthContinuation,
      signal: AbortSignal,
    ) =>
      updateInteractively(
        (previous) =>
          afterPasswordReset(
            { ...previous, token: session?.token },
            email,
            continuation,
          ),
        signal,
      ),
    beginVerification: createBeginVerification(
      updateInteractively,
      session?.token,
    ),
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

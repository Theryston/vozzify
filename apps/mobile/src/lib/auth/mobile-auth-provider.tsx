import type { AuthSessionUser, SetUsernameBody } from '@vozzify/contracts';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { restoreAuthSession, saveUsername } from './auth-api';
import type { AuthContinuation } from './auth-continuation';
import { readAuth, type StoredAuth, writeAuth } from './auth-storage';
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

function useRestoreAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [record, setRecord] = useState<StoredAuth>({});
  const stored = useRef<StoredAuth>({});
  useEffect(() => {
    if (status !== 'loading') return;
    let active = true;
    void restore().then(
      (result) => {
        if (!active) return;
        stored.current = result.stored;
        setRecord(result.stored);
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
  }, [status]);

  async function consumeContinuation() {
    const { continuation, ...next } = stored.current;
    if (!continuation) return undefined;
    stored.current = next;
    setRecord(next);
    try {
      await writeAuth(next);
      return continuation;
    } catch {
      return undefined;
    }
  }

  return {
    status,
    user,
    setUser,
    record,
    setRecord,
    stored,
    retry: () => setStatus('loading'),
    consumeContinuation,
  };
}

function useAuthOperations() {
  const {
    status,
    user,
    setUser,
    record,
    setRecord,
    stored,
    retry,
    consumeContinuation,
  } = useRestoreAuth();
  async function persist(next: StoredAuth) {
    await writeAuth(next);
    stored.current = next;
    setRecord(next);
  }

  async function beginVerification(
    verification: NonNullable<StoredAuth['verification']>,
    continuation: AuthContinuation,
  ) {
    if (verification.email) {
      recordCodeSent(
        verification.email,
        'email-verification',
        verification.sentAt,
      );
    }
    await persist({ ...stored.current, verification, continuation });
  }

  async function cancelOnboarding() {
    const { token, verification, continuation } = stored.current;
    if (verification || continuation) await persist({ token });
  }

  async function completeAuth(
    session: { user: AuthSessionUser; token: string },
    continuation: AuthContinuation,
  ) {
    await persist({ token: session.token, continuation });
    setUser(session.user);
  }

  async function chooseUsername(body: SetUsernameBody) {
    const { token } = stored.current;
    if (!token) return;
    const nextUser = await saveUsername(body, token);
    setUser(
      (current) => current && { ...current, username: nextUser.username },
    );
  }

  return {
    status,
    user,
    retry,
    ...record,
    beginVerification,
    cancelOnboarding,
    completeAuth,
    chooseUsername,
    consumeContinuation,
  };
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

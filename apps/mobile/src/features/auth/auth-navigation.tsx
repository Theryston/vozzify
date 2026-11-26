import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  authContinuationFromParams,
  authRouteParams,
} from '../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../lib/auth/mobile-auth-provider';

const authRoutes = new Set([
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/setup-username',
]);

type MobileAuth = ReturnType<typeof useMobileAuth>;

function requiredAuthRoute(auth: MobileAuth, path: string) {
  if (auth.user) {
    if (!auth.user.emailVerified) return '/verify-email';
    if (!auth.user.username) return '/setup-username';
    return undefined;
  }
  if (auth.verification && !authRoutes.has(path)) return '/verify-email';
  if (path === '/setup-username') return '/sign-in';
  return undefined;
}

export function AuthNavigation() {
  const path = usePathname();
  const router = useRouter();
  const params = useGlobalSearchParams();
  const auth = useMobileAuth();
  const continuation = auth.continuation ?? authContinuationFromParams(params);

  useEffect(() => {
    if (auth.status !== 'ready') return;
    const required = requiredAuthRoute(auth, path);
    if (required === path) return;
    if (required) {
      router.replace({
        pathname: required,
        params: authRouteParams(continuation),
      });
      return;
    }
    if (!auth.user) return;
    const hasArrival = auth.continuation !== undefined;
    const needsArrival = hasArrival && path !== continuation.destination;
    if (authRoutes.has(path) || needsArrival) {
      router.dismissTo(continuation.destination);
    } else if (hasArrival && path === '/') {
      void auth.consumeContinuation();
    }
  }, [auth, continuation, path, router]);

  return null;
}

import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  authContinuationFromParams,
  authRouteParams,
} from '../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../lib/auth/mobile-auth-provider';
import { usePushDeviceRegistration } from '../../lib/push/use-push-device-registration';

const authRoutes = new Set([
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/setup-username',
  '/forgot-password',
  '/forgot-password/reset',
]);

type MobileAuth = ReturnType<typeof useMobileAuth>;

function requiredAuthRoute(auth: MobileAuth, path: string) {
  if (auth.user) {
    if (!auth.user.emailVerified) return '/verify-email';
    if (!auth.user.username) return '/setup-username';
    return undefined;
  }
  if (!authRoutes.has(path)) {
    if (auth.passwordReset) return '/sign-in';
    if (auth.verification) return '/verify-email';
  }
  if (path === '/setup-username') return '/sign-in';
  return undefined;
}

function useOnboardingRoute() {
  const path = usePathname();
  const router = useRouter();
  const params = useGlobalSearchParams();
  const auth = useMobileAuth();
  const isAuthRoute = authRoutes.has(path);
  const continuation =
    auth.passwordReset ??
    auth.continuation ??
    authContinuationFromParams(isAuthRoute ? params : { redirectTo: path });
  const required =
    auth.status === 'ready' ? requiredAuthRoute(auth, path) : undefined;

  useEffect(() => {
    if (!required || required === path) return;
    const controller = new AbortController();
    const navigate = () => {
      if (!controller.signal.aborted) {
        router.replace({
          pathname: required,
          params: authRouteParams(continuation),
        });
      }
    };
    // Retain a cold-open destination if the app is closed during onboarding.
    if (isAuthRoute || auth.continuation || auth.passwordReset) navigate();
    else
      void auth
        .rememberContinuation(continuation, controller.signal)
        .then(navigate, navigate);
    return () => {
      controller.abort();
    };
  }, [auth, continuation, isAuthRoute, path, required, router]);

  return { path, router, auth, continuation, isAuthRoute, required };
}

export function AuthNavigation() {
  const { path, router, auth, continuation, isAuthRoute, required } =
    useOnboardingRoute();

  useEffect(() => {
    if (auth.status !== 'ready' || !auth.user || required) return;
    const hasArrival = auth.continuation !== undefined;
    const needsArrival = hasArrival && path !== continuation.destination;
    if (isAuthRoute || needsArrival) {
      router.dismissTo(continuation.destination);
    } else if (hasArrival && path === '/') {
      void auth.consumeContinuation();
    }
  }, [auth, continuation, isAuthRoute, path, required, router]);

  const user = auth.status === 'ready' ? auth.user : null;
  const eligible = Boolean(user?.emailVerified && user.username);
  const atDestination =
    (path === '/' || path === '/components') &&
    (!auth.continuation || path === continuation.destination);
  const arrival = !eligible
    ? 'onboarding'
    : atDestination
      ? 'arrived'
      : 'travelling';
  usePushDeviceRegistration(user?.id, auth.token, arrival);

  return null;
}

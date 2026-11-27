import type { ReactNode } from 'react';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function AuthDestination({
  path,
  children,
}: {
  path: '/' | '/components';
  children: ReactNode;
}) {
  const { status, user, verification, continuation, passwordReset } =
    useMobileAuth();
  if (status === 'loading') return children;
  if (!user) return verification || passwordReset ? null : children;

  const incomplete = !user.emailVerified || !user.username;
  const arrivingElsewhere = continuation && continuation.destination !== path;
  return incomplete || arrivingElsewhere ? null : children;
}

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { AuthRestoreStatus } from './auth-restore-status';

export function AuthDestination({
  path,
  children,
}: {
  path: '/' | '/components';
  children: ReactNode;
}) {
  const { status, user, verification, continuation } = useMobileAuth();
  if (status !== 'ready') {
    return (
      <View className="flex-1 items-center justify-center gap-4 px-page-gutter-mobile">
        <AuthRestoreStatus />
      </View>
    );
  }
  if (!user) return verification ? null : children;

  const incomplete = !user.emailVerified || !user.username;
  const arrivingElsewhere = continuation && continuation.destination !== path;
  return incomplete || arrivingElsewhere ? null : children;
}

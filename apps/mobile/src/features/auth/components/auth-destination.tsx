import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function AuthDestination({
  path,
  children,
}: {
  path: '/' | '/components';
  children: ReactNode;
}) {
  const t = useTranslations('auth');
  const { status, user, verification, continuation } = useMobileAuth();
  if (status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator accessibilityLabel={t('loading')} />
      </View>
    );
  }
  if (!user) return verification ? null : children;

  const incomplete = !user.emailVerified || !user.username;
  const arrivingElsewhere = continuation && continuation.destination !== path;
  return incomplete || arrivingElsewhere ? null : children;
}

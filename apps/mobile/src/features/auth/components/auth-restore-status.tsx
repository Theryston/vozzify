import { ActivityIndicator } from 'react-native';
import { useTranslations } from 'use-intl';
import { Text } from '../../../components/text';
import { Button } from '../../../components/ui/button';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function AuthRestoreStatus() {
  const { status, retry } = useMobileAuth();
  const t = useTranslations('auth');

  if (status === 'loading') {
    return <ActivityIndicator accessibilityLabel={t('loading')} />;
  }

  return (
    <>
      <Text accessibilityRole="alert">{t('restoreError')}</Text>
      <Button onPress={retry}>{t('retry')}</Button>
    </>
  );
}

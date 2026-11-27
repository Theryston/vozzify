import { Link } from 'expo-router';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Text } from '../../../components/text';
import { Button } from '../../../components/ui/button';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function HomeAuth() {
  const t = useTranslations('auth');
  const home = useTranslations('home');
  const { status, user } = useMobileAuth();
  if (user?.username) {
    return <Text>{home('signedIn', { username: user.username })}</Text>;
  }
  if (status === 'loading' || user) return null;

  return (
    <View className="gap-2">
      <Link href="/sign-in" asChild>
        <Button accessibilityRole="link" testID="open-sign-in">
          {t('signIn.submit')}
        </Button>
      </Link>
      <Link href="/sign-up" asChild>
        <Button
          accessibilityRole="link"
          testID="open-sign-up"
          variant="outline"
        >
          {t('signUp.submit')}
        </Button>
      </Link>
    </View>
  );
}

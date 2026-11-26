import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  View,
} from 'react-native';
import { useTranslations } from 'use-intl';
import { Screen } from '../../../components/screen';
import { Text } from '../../../components/text';
import { Button } from '../../../components/ui/button';
import {
  authContinuationFromParams,
  authRouteParams,
} from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function useAuthContinuation() {
  const params = useLocalSearchParams();
  return authContinuationFromParams(params);
}

export function AuthLink({
  to,
  children,
}: {
  to: '/sign-in' | '/sign-up';
  children: ReactNode;
}) {
  const params = authRouteParams(useAuthContinuation());
  return (
    <Link href={{ pathname: to, params }} replace asChild>
      <Button accessibilityRole="link" variant="outline">
        {children}
      </Button>
    </Link>
  );
}

function AuthExit() {
  const t = useTranslations('auth');
  const router = useRouter();
  const auth = useMobileAuth();
  const continuation = useAuthContinuation();
  if (auth.user) return null;

  return (
    <Button
      variant="outline"
      accessibilityRole="link"
      onPress={() => {
        void auth.cancelOnboarding().then(() => {
          router.dismissTo(continuation.destination);
        }, auth.retry);
      }}
    >
      {t('leave')}
    </Button>
  );
}

export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const auth = useMobileAuth();
  const t = useTranslations('auth');
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <Screen>
        <View className="w-full max-w-md flex-1 justify-center gap-8 self-center py-6">
          <View className="gap-2">
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
            <Text className="text-muted-foreground">{description}</Text>
          </View>
          <View className="gap-5">
            {auth.status === 'ready' ? (
              <>
                {children}
                <AuthExit />
              </>
            ) : null}
            {auth.status === 'loading' ? (
              <ActivityIndicator accessibilityLabel={t('loading')} />
            ) : null}
            {auth.status === 'error' ? (
              <>
                <Text accessibilityRole="alert">{t('restoreError')}</Text>
                <Button onPress={auth.retry}>{t('retry')}</Button>
              </>
            ) : null}
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

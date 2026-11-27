import {
  Link,
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  usePreventRemove,
} from 'expo-router';
import { type ReactNode, useCallback, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { Text } from '../../../components/text';
import { Button } from '../../../components/ui/button';
import {
  authContinuationFromParams,
  authRouteParams,
} from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function useAuthContinuation() {
  return authContinuationFromParams(useLocalSearchParams());
}

type AuthLinkProps = {
  to: '/sign-in' | '/sign-up' | '/forgot-password';
  children: string;
  primary?: boolean;
};

export function AuthLink({ to, children, primary }: AuthLinkProps) {
  const params = authRouteParams(useAuthContinuation());
  return (
    <Link href={{ pathname: to, params }} replace asChild>
      {primary ? (
        <Button accessibilityRole="link" size="medium">
          {children}
        </Button>
      ) : (
        <Pressable
          accessibilityRole="link"
          className="min-h-10 justify-center rounded-full px-2 active:bg-accent"
        >
          <Text className="text-sm" weight="semibold">
            {children}
          </Text>
        </Pressable>
      )}
    </Link>
  );
}

export function AuthFooterLink({
  caption,
  ...link
}: AuthLinkProps & { caption?: string }) {
  return (
    <View className="flex-row flex-wrap items-center justify-center">
      {caption ? (
        <Text className="text-muted-foreground text-sm">{caption}</Text>
      ) : null}
      <AuthLink {...link} />
    </View>
  );
}

function useCancelOnBack() {
  const auth = useMobileAuth();
  const focused = useIsFocused();
  const [leaving, setLeaving] = useState(false);
  useFocusEffect(useCallback(() => setLeaving(false), []));
  const pending =
    !auth.user && Boolean(auth.verification || auth.passwordReset);
  usePreventRemove(focused && pending && !leaving, ({ data, repeat }) => {
    const leave = () => {
      setLeaving(true);
      repeat();
    };
    if (['GO_BACK', 'POP', 'POP_TO_TOP'].includes(data.action.type)) {
      void auth.cancelOnboarding().then(leave, leave);
    } else {
      leave();
    }
  });
}

function AuthBrand() {
  const t = useTranslations('auth');
  return (
    <View className="min-h-16 flex-row items-center gap-1.5 px-page-gutter-mobile">
      <Image
        accessible={false}
        className="size-6"
        resizeMode="contain"
        source={require('../../../../assets/splash.png')}
        tintColorClassName="accent-primary"
      />
      <Text className="text-[22px] leading-7 tracking-tight" weight="bold">
        {t('brand')}
      </Text>
    </View>
  );
}

type AuthFrameProps = {
  title: string;
  description?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthFrame({
  title,
  description,
  notice,
  children,
  footer,
}: AuthFrameProps) {
  useCancelOnBack();
  return (
    <View className="flex-1 bg-background" testID="auth-screen-surface">
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="flex-grow"
            keyboardShouldPersistTaps="handled"
          >
            <AuthBrand />
            <View className="mx-auto w-full max-w-md flex-1 justify-center gap-6 px-page-gutter-mobile pt-7 pb-9">
              <View className="gap-3">
                <Text
                  accessibilityRole="header"
                  className="text-4xl leading-10"
                  variant="heading"
                >
                  {title}
                </Text>
                {description ? (
                  <Text className="text-muted-foreground">{description}</Text>
                ) : null}
                {notice}
              </View>
              <View className="gap-4">{children}</View>
            </View>
            {footer ? (
              <View className="items-center border-border border-t bg-surface px-page-gutter-mobile pt-5 pb-4">
                <View className="w-full max-w-md gap-2">{footer}</View>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

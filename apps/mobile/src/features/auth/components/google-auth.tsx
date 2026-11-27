import { Image } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { MobileAuthError } from '../../../lib/api/mobile-api-error';
import { signInWithGoogle } from '../../../lib/auth/auth-api';
import type { AuthContinuation } from '../../../lib/auth/auth-continuation';
import {
  chooseGoogleAccount,
  isGoogleSignInAvailable,
} from '../../../lib/auth/google-sign-in';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export const googleAuthMethodSchema = z.object({ method: z.literal('google') });

export function useGoogleAuth(continuation: AuthContinuation) {
  const auth = useMobileAuth();
  const locale = useLocale();

  return async (signal: AbortSignal) => {
    try {
      const token = await chooseGoogleAccount();
      if (signal.aborted || token === null) return;
      const session = await signInWithGoogle(token, locale, signal);
      await auth.completeAuth(session, continuation, signal);
    } catch {
      throw new MobileAuthError(400, 'GOOGLE_SIGN_IN_FAILED');
    }
  };
}

export function GoogleButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTranslations('auth');
  if (!isGoogleSignInAvailable()) return null;
  return (
    <Button
      disabled={disabled}
      size="medium"
      variant="secondary"
      onPress={onPress}
      leading={
        <Image
          accessible={false}
          className="size-4"
          resizeMode="contain"
          source={require('../../../../assets/google-mark.png')}
          tintColorClassName="accent-foreground"
        />
      }
    >
      {t('continueWithGoogle')}
    </Button>
  );
}

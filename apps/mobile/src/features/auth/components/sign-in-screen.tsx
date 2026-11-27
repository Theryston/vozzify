import { signInBodySchema } from '@vozzify/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { signIn } from '../../../lib/auth/auth-api';
import { authRouteParams } from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { authErrorKey } from '../auth-errors';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthField, AuthNotice } from './auth-field';
import {
  AuthFooterLink,
  AuthFrame,
  AuthLink,
  useAuthContinuation,
} from './auth-frame';
import { PasswordField } from './credential-fields';

import {
  GoogleButton,
  googleAuthMethodSchema,
  useGoogleAuth,
} from './google-auth';

const formSchema = z.discriminatedUnion('method', [
  signInBodySchema.extend({ method: z.literal('credentials') }),
  googleAuthMethodSchema,
]);

function useSignIn() {
  const auth = useMobileAuth();
  const locale = useLocale();
  const router = useRouter();
  const routeContinuation = useAuthContinuation();
  const continuation = auth.passwordReset ?? routeContinuation;
  const googleAuth = useGoogleAuth(continuation);

  return useAuthSubmit(formSchema, async (values, signal) => {
    if (values.method === 'google') return googleAuth(signal);
    try {
      const session = await signIn(values, locale, signal);
      await auth.completeAuth(session, continuation, signal);
    } catch (error) {
      if (authErrorKey(error) !== 'EMAIL_NOT_VERIFIED') throw error;
      const email = values.emailOrUsername.includes('@')
        ? values.emailOrUsername
        : null;
      const saved = await auth.beginVerification(
        { email, sentAt: Date.now() },
        continuation,
        signal,
      );
      if (!saved) return;
      router.replace({
        pathname: '/verify-email',
        params: authRouteParams(continuation),
      });
    }
  });
}

function SignInForm({ form }: { form: ReturnType<typeof useSignIn> }) {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const [emailOrUsername, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  return (
    <>
      <AuthField
        label={t('emailOrUsername')}
        error={
          form.invalid.has('emailOrUsername')
            ? t('identifierRequired')
            : undefined
        }
        autoCapitalize="none"
        autoComplete="username"
        keyboardType="email-address"
        testID="sign-in-identifier"
        spellCheck={false}
        value={emailOrUsername}
        onChangeText={(value) => {
          setIdentifier(value);
          form.clear('emailOrUsername');
        }}
      />
      <PasswordField
        aside={<AuthLink to="/forgot-password">{t('recovery.link')}</AuthLink>}
        existing
        value={password}
        error={form.invalid.has('password') ? t('passwordRequired') : undefined}
        onChangeText={(value) => {
          setPassword(value);
          form.clear('password');
        }}
      />
      {form.error ? <AuthNotice error>{errors(form.error)}</AuthNotice> : null}
      <Button
        size="medium"
        disabled={form.pending}
        onPress={() =>
          void form.submit({ method: 'credentials', emailOrUsername, password })
        }
        testID="submit-sign-in"
      >
        {form.pending ? t('submitting') : t('signIn.submit')}
      </Button>
    </>
  );
}

export function SignInScreen() {
  const t = useTranslations('auth');
  const { passwordReset } = useMobileAuth();
  const form = useSignIn();
  return (
    <AuthFrame
      title={t('signIn.submit')}
      notice={
        passwordReset ? (
          <AuthNotice success>{t('recovery.complete')}</AuthNotice>
        ) : null
      }
      footer={
        <>
          <GoogleButton
            disabled={form.pending}
            onPress={() => void form.submit({ method: 'google' })}
          />
          <AuthFooterLink caption={t('signIn.noAccount')} to="/sign-up">
            {t('signUp.submit')}
          </AuthFooterLink>
        </>
      }
    >
      <SignInForm form={form} />
    </AuthFrame>
  );
}

import { type SignInBody, signInBodySchema } from '@vozzify/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { signIn } from '../../../lib/auth/auth-api';
import { authRouteParams } from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { authErrorKey } from '../auth-errors';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthField, AuthNotice } from './auth-field';
import { AuthFrame, AuthLink, useAuthContinuation } from './auth-frame';
import { PasswordField } from './credential-fields';

function useSignIn() {
  const auth = useMobileAuth();
  const locale = useLocale();
  const router = useRouter();
  const routeContinuation = useAuthContinuation();
  const continuation = auth.passwordReset ?? routeContinuation;

  return useAuthSubmit(signInBodySchema, async (values: SignInBody, signal) => {
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

function SignInForm() {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const [emailOrUsername, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const form = useSignIn();
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
        disabled={form.pending}
        onPress={() => void form.submit({ emailOrUsername, password })}
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
  return (
    <AuthFrame title={t('signIn.title')} description={t('signIn.description')}>
      {passwordReset ? <AuthNotice>{t('recovery.complete')}</AuthNotice> : null}
      <SignInForm />
      <AuthLink to="/forgot-password">{t('recovery.link')}</AuthLink>
      <AuthLink to="/sign-up">{t('signUp.submit')}</AuthLink>
    </AuthFrame>
  );
}

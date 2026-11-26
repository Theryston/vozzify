import { forgotPasswordBodySchema } from '@vozzify/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { sendAuthCode } from '../../../lib/auth/auth-api';
import { authRouteParams } from '../../../lib/auth/auth-continuation';
import {
  isCodeCoolingDown,
  recordCodeSent,
} from '../../../lib/auth/use-code-cooldown';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthNotice } from './auth-field';
import { AuthFrame, AuthLink, useAuthContinuation } from './auth-frame';
import { EmailField } from './credential-fields';

function useRecoveryRequest() {
  const router = useRouter();
  const continuation = useAuthContinuation();
  const locale = useLocale();

  return useAuthSubmit(forgotPasswordBodySchema, async ({ email }, signal) => {
    const purpose = 'forget-password';
    if (!isCodeCoolingDown(email, purpose)) {
      await sendAuthCode(email, purpose, locale, signal);
      recordCodeSent(email, purpose, Date.now());
    }
    if (signal.aborted) return;
    router.replace({
      pathname: '/forgot-password/reset',
      params: { ...authRouteParams(continuation), email },
    });
  });
}

function RecoveryRequestForm() {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const [email, setEmail] = useState('');
  const form = useRecoveryRequest();
  return (
    <>
      <EmailField
        value={email}
        error={form.invalid.has('email') ? errors('INVALID_EMAIL') : undefined}
        onChangeText={(value) => {
          setEmail(value);
          form.clear('email');
        }}
      />
      {form.error ? <AuthNotice error>{errors(form.error)}</AuthNotice> : null}
      <Button
        disabled={form.pending}
        onPress={() => void form.submit({ email: email.trim().toLowerCase() })}
        testID="submit-forgot-password"
      >
        {form.pending ? t('submitting') : t('recovery.request.submit')}
      </Button>
    </>
  );
}

export function ForgotPasswordScreen() {
  const t = useTranslations('auth');

  return (
    <AuthFrame
      title={t('recovery.request.title')}
      description={t('recovery.request.description')}
    >
      <RecoveryRequestForm />
      <AuthLink to="/sign-in">{t('signIn.submit')}</AuthLink>
    </AuthFrame>
  );
}

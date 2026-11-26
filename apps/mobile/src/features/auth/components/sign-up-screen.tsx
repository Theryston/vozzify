import { signUpBodySchema } from '@vozzify/contracts';
import {
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@vozzify/contracts/auth-rules';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { signUp } from '../../../lib/auth/auth-api';
import { authRouteParams } from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthField, AuthNotice } from './auth-field';
import { AuthFrame, AuthLink, useAuthContinuation } from './auth-frame';
import { EmailField, PasswordField } from './credential-fields';
import { PasswordStrengthMeter } from './password-strength-meter';

function useSignUp() {
  const auth = useMobileAuth();
  const locale = useLocale();
  const router = useRouter();
  const continuation = useAuthContinuation();

  return useAuthSubmit(signUpBodySchema, async (values) => {
    await signUp(values, locale);
    await auth.beginVerification(
      { email: values.email, sentAt: Date.now() },
      continuation,
    );
    router.replace({
      pathname: '/verify-email',
      params: authRouteParams(continuation),
    });
  });
}

function SignUpForm() {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useSignUp();
  return (
    <>
      <AuthField
        label={t('name')}
        autoComplete="name"
        autoCapitalize="words"
        value={name}
        error={
          form.invalid.has('name')
            ? t('nameInvalid', { max: NAME_MAX_LENGTH })
            : undefined
        }
        onChangeText={(value) => {
          setName(value);
          form.clear('name');
        }}
      />
      <EmailField
        value={email}
        error={form.invalid.has('email') ? errors('INVALID_EMAIL') : undefined}
        onChangeText={(value) => {
          setEmail(value);
          form.clear('email');
        }}
      />
      <PasswordField
        value={password}
        error={
          form.invalid.has('password')
            ? t('passwordInvalid', {
                min: PASSWORD_MIN_LENGTH,
                max: PASSWORD_MAX_LENGTH,
              })
            : undefined
        }
        onChangeText={(value) => {
          setPassword(value);
          form.clear('password');
        }}
      />
      <PasswordStrengthMeter password={password} />
      {form.error ? <AuthNotice error>{errors(form.error)}</AuthNotice> : null}
      <Button
        disabled={form.pending}
        onPress={() =>
          void form.submit({ name, email: email.trim(), password })
        }
        testID="submit-sign-up"
      >
        {form.pending ? t('submitting') : t('signUp.submit')}
      </Button>
    </>
  );
}

export function SignUpScreen() {
  const t = useTranslations('auth');
  return (
    <AuthFrame title={t('signUp.title')} description={t('signUp.description')}>
      <SignUpForm />
      <AuthLink to="/sign-in">{t('signIn.submit')}</AuthLink>
    </AuthFrame>
  );
}

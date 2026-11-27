import { signUpBodySchema } from '@vozzify/contracts';
import { NAME_MAX_LENGTH } from '@vozzify/contracts/auth-rules';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { signUp } from '../../../lib/auth/auth-api';
import { authRouteParams } from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthField, AuthNotice } from './auth-field';
import { AuthFooterLink, AuthFrame, useAuthContinuation } from './auth-frame';
import { EmailField, NewPasswordField } from './credential-fields';
import {
  GoogleButton,
  googleAuthMethodSchema,
  useGoogleAuth,
} from './google-auth';

const formSchema = z.discriminatedUnion('method', [
  signUpBodySchema.extend({ method: z.literal('credentials') }),
  googleAuthMethodSchema,
]);

function useSignUp() {
  const auth = useMobileAuth();
  const locale = useLocale();
  const router = useRouter();
  const continuation = useAuthContinuation();
  const googleAuth = useGoogleAuth(continuation);

  return useAuthSubmit(formSchema, async (values, signal) => {
    if (values.method === 'google') return googleAuth(signal);
    await signUp(values, locale, signal);
    const saved = await auth.beginVerification(
      { email: values.email, sentAt: Date.now() },
      continuation,
      signal,
    );
    if (!saved) return;
    router.replace({
      pathname: '/verify-email',
      params: authRouteParams(continuation),
    });
  });
}

function SignUpForm({ form }: { form: ReturnType<typeof useSignUp> }) {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      <NewPasswordField
        value={password}
        invalid={form.invalid.has('password')}
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
          void form.submit({
            method: 'credentials',
            name,
            email: email.trim(),
            password,
          })
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
  const form = useSignUp();
  return (
    <AuthFrame
      title={t('signUp.title')}
      description={t('signUp.description')}
      footer={
        <>
          <GoogleButton
            disabled={form.pending}
            onPress={() => void form.submit({ method: 'google' })}
          />
          <AuthFooterLink caption={t('signUp.hasAccount')} to="/sign-in">
            {t('signIn.submit')}
          </AuthFooterLink>
        </>
      }
    >
      <SignUpForm form={form} />
    </AuthFrame>
  );
}

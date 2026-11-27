import {
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
} from '@vozzify/contracts';
import { OTP_LENGTH } from '@vozzify/contracts/auth-rules';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { resetPassword } from '../../../lib/auth/auth-api';
import { authRouteParams } from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { isCodeError } from '../auth-errors';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthField, AuthNotice } from './auth-field';
import {
  AuthFooterLink,
  AuthFrame,
  AuthLink,
  useAuthContinuation,
} from './auth-frame';
import { NewPasswordField } from './credential-fields';
import { ResendCode } from './resend-code';

function usePasswordReset(onBadCode: () => void) {
  const auth = useMobileAuth();
  const router = useRouter();
  const continuation = useAuthContinuation();
  const locale = useLocale();

  return useAuthSubmit(
    resetPasswordBodySchema,
    async (values, signal) => {
      await resetPassword(values, locale, signal);
      const saved = await auth.finishPasswordReset(
        values.email,
        continuation,
        signal,
      );
      if (!saved) return;
      router.replace({
        pathname: '/sign-in',
        params: authRouteParams(continuation),
      });
    },
    (key) => {
      if (isCodeError(key)) onBadCode();
    },
  );
}

function ResetCodeField({
  value,
  error,
  onChangeText,
}: {
  value: string;
  error?: string;
  onChangeText: (value: string) => void;
}) {
  const t = useTranslations('auth.recovery.reset');
  return (
    <AuthField
      label={t('code')}
      autoComplete="one-time-code"
      keyboardType="number-pad"
      maxLength={OTP_LENGTH}
      value={value}
      error={error}
      onChangeText={(text) => onChangeText(text.replace(/[^0-9]/g, ''))}
    />
  );
}

function ResetPasswordForm({ email }: { email: string }) {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const form = usePasswordReset(() => setOtp(''));
  const codeErrorKey =
    form.error && isCodeError(form.error) ? form.error : undefined;
  const codeError = codeErrorKey
    ? errors(codeErrorKey)
    : form.invalid.has('otp')
      ? t('codeInvalid', { count: OTP_LENGTH })
      : undefined;
  return (
    <AuthFrame
      title={t('recovery.reset.title')}
      description={t('recovery.reset.description', { email })}
      footer={
        <ResetFooter
          email={email}
          onSent={() => {
            setOtp('');
            form.clear('otp');
          }}
        />
      }
    >
      <ResetCodeField
        value={otp}
        error={codeError}
        onChangeText={(value) => {
          setOtp(value);
          form.clear('otp');
        }}
      />
      <NewPasswordField
        label={t('recovery.reset.password')}
        value={password}
        invalid={form.invalid.has('password')}
        onChangeText={(value) => {
          setPassword(value);
          form.clear('password');
        }}
      />
      {form.error && !codeErrorKey ? (
        <AuthNotice error>{errors(form.error)}</AuthNotice>
      ) : null}
      <Button
        size="medium"
        disabled={form.pending}
        onPress={() => void form.submit({ email, otp, password })}
        testID="submit-reset-password"
      >
        {form.pending ? t('submitting') : t('recovery.reset.submit')}
      </Button>
    </AuthFrame>
  );
}

function ResetFooter({ email, onSent }: { email: string; onSent: () => void }) {
  const t = useTranslations('auth.recovery.reset');
  return (
    <>
      <ResendCode
        email={email}
        purpose="forget-password"
        successMessage={t('resent')}
        onSent={onSent}
      />
      <AuthFooterLink to="/forgot-password">
        {t('differentEmail')}
      </AuthFooterLink>
    </>
  );
}

function MissingRecoveryAddress() {
  const t = useTranslations('auth');

  return (
    <AuthFrame
      title={t('recovery.missing.title')}
      description={t('recovery.missing.description')}
      footer={
        <AuthFooterLink to="/sign-in">{t('signIn.submit')}</AuthFooterLink>
      }
    >
      <AuthLink primary to="/forgot-password">
        {t('recovery.missing.submit')}
      </AuthLink>
    </AuthFrame>
  );
}

export function ResetPasswordScreen() {
  const { email } = useLocalSearchParams();
  const address = forgotPasswordBodySchema.safeParse({ email });

  if (!address.success) return <MissingRecoveryAddress />;
  const normalizedEmail = address.data.email.toLowerCase();
  return <ResetPasswordForm key={normalizedEmail} email={normalizedEmail} />;
}

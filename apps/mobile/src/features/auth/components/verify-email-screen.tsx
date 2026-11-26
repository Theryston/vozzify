import { verifyEmailBodySchema } from '@vozzify/contracts';
import { OTP_LENGTH } from '@vozzify/contracts/auth-rules';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { verifyEmail } from '../../../lib/auth/auth-api';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';
import { isCodeError } from '../auth-errors';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthField, AuthNotice } from './auth-field';
import { AuthFrame, AuthLink, useAuthContinuation } from './auth-frame';
import { EmailField } from './credential-fields';
import { ResendCode } from './resend-code';

function useVerifyEmail(initialEmail: string) {
  const locale = useLocale();
  const auth = useMobileAuth();
  const routeContinuation = useAuthContinuation();
  const continuation = auth.continuation ?? routeContinuation;
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const form = useAuthSubmit(
    verifyEmailBodySchema,
    async (values, signal) => {
      const session = await verifyEmail(values, locale, signal);
      await auth.completeAuth(session, continuation, signal);
    },
    (key) => {
      if (isCodeError(key)) setOtp('');
    },
  );

  return { auth, continuation, email, setEmail, otp, setOtp, form };
}

function VerifyEmailForm({
  initialEmail,
  sentAt,
}: {
  initialEmail: string;
  sentAt?: number;
}) {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const { auth, continuation, email, setEmail, otp, setOtp, form } =
    useVerifyEmail(initialEmail);
  return (
    <>
      {initialEmail ? (
        <AuthNotice>
          {t(sentAt ? 'verifyEmail.sentTo' : 'verifyEmail.emailToVerify', {
            email: initialEmail,
          })}
        </AuthNotice>
      ) : (
        <EmailField
          value={email}
          error={
            form.invalid.has('email') ? errors('INVALID_EMAIL') : undefined
          }
          onChangeText={(value) => {
            setEmail(value);
            form.clear('email');
          }}
        />
      )}
      <AuthField
        label={t('code')}
        autoComplete="one-time-code"
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        value={otp}
        error={
          form.invalid.has('otp')
            ? t('codeInvalid', { count: OTP_LENGTH })
            : undefined
        }
        onChangeText={(value) => {
          setOtp(value.replace(/[^0-9]/g, ''));
          form.clear('otp');
        }}
      />
      {form.error ? <AuthNotice error>{errors(form.error)}</AuthNotice> : null}
      <Button
        disabled={form.pending}
        onPress={() => void form.submit({ email: email.trim(), otp })}
        testID="submit-verify-email"
      >
        {form.pending ? t('submitting') : t('verifyEmail.submit')}
      </Button>
      <ResendCode
        email={email}
        purpose="email-verification"
        sentAt={sentAt}
        onSent={async (address, time, signal) => {
          await auth.beginVerification(
            { email: address, sentAt: time },
            continuation,
            signal,
          );
        }}
      />
    </>
  );
}

export function VerifyEmailScreen() {
  const t = useTranslations('auth');
  const { user, verification } = useMobileAuth();
  const email = verification?.email ?? user?.email ?? '';
  return (
    <AuthFrame
      title={t('verifyEmail.title')}
      description={t(
        email ? 'verifyEmail.description' : 'verifyEmail.enterEmail',
      )}
    >
      <VerifyEmailForm initialEmail={email} sentAt={verification?.sentAt} />
      <AuthLink to="/sign-in">{t('signIn.submit')}</AuthLink>
    </AuthFrame>
  );
}

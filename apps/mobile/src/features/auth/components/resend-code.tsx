import {
  type AuthCodePurpose,
  sendAuthCodeBodySchema,
} from '@vozzify/contracts';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { sendAuthCode } from '../../../lib/auth/auth-api';
import { useCodeCooldown } from '../../../lib/auth/use-code-cooldown';
import { useAuthSubmit } from '../use-auth-submit';
import { AuthNotice } from './auth-field';

type ResendCodeProps = {
  email: string;
  purpose: AuthCodePurpose;
  sentAt?: number;
  successMessage?: string;
  onSent?: (
    email: string,
    time: number,
    signal: AbortSignal,
  ) => void | Promise<void>;
};

export function ResendCode({
  email,
  purpose,
  sentAt,
  successMessage,
  onSent,
}: ResendCodeProps) {
  const t = useTranslations('auth');
  const errors = useTranslations('authErrors');
  const locale = useLocale();
  const [resent, setResent] = useState(false);
  const { seconds, restart } = useCodeCooldown(email, purpose, sentAt);
  const form = useAuthSubmit(sendAuthCodeBodySchema, async (values, signal) => {
    setResent(false);
    await sendAuthCode(values.email, values.type, locale, signal);
    if (signal.aborted) return;
    const at = restart();
    setResent(true);
    await onSent?.(values.email, at, signal);
  });
  return (
    <>
      {form.invalid.has('email') ? (
        <AuthNotice error>{errors('INVALID_EMAIL')}</AuthNotice>
      ) : null}
      {form.error ? <AuthNotice error>{errors(form.error)}</AuthNotice> : null}
      {resent && successMessage ? (
        <AuthNotice>{successMessage}</AuthNotice>
      ) : null}
      <Button
        disabled={form.pending || seconds > 0}
        onPress={() => void form.submit({ email: email.trim(), type: purpose })}
        testID="resend-code"
        variant="outline"
      >
        {seconds > 0 ? t('resendIn', { seconds }) : t('resend')}
      </Button>
    </>
  );
}

import type { ComponentProps } from 'react';
import { useTranslations } from 'use-intl';
import { AuthField } from './auth-field';

type FieldProps = Pick<
  ComponentProps<typeof AuthField>,
  'value' | 'onChangeText' | 'error'
>;

export function EmailField(props: FieldProps) {
  const t = useTranslations('auth');
  return (
    <AuthField
      autoCapitalize="none"
      autoComplete="email"
      keyboardType="email-address"
      label={t('email')}
      spellCheck={false}
      {...props}
    />
  );
}

export function PasswordField({
  existing,
  ...props
}: FieldProps & { existing?: boolean }) {
  const t = useTranslations('auth');
  return (
    <AuthField
      autoCapitalize="none"
      autoComplete={existing ? 'current-password' : 'new-password'}
      label={t('password')}
      password
      spellCheck={false}
      {...props}
    />
  );
}

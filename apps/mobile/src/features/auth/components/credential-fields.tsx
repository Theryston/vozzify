import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@vozzify/contracts/auth-rules';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { AuthField } from './auth-field';
import { PasswordStrengthMeter } from './password-strength-meter';

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
  label,
  ...props
}: FieldProps & {
  existing?: boolean;
  label?: string;
  aside?: ComponentProps<typeof AuthField>['aside'];
  hint?: string;
}) {
  const t = useTranslations('auth');
  return (
    <AuthField
      autoCapitalize="none"
      autoComplete={existing ? 'current-password' : 'new-password'}
      label={label ?? t('password')}
      password
      spellCheck={false}
      testID="auth-password"
      {...props}
    />
  );
}

export function NewPasswordField({
  label,
  value = '',
  invalid,
  onChangeText,
}: Omit<FieldProps, 'error'> & { label?: string; invalid: boolean }) {
  const t = useTranslations('auth');
  return (
    <View className="gap-1.5">
      <PasswordField
        label={label}
        value={value}
        hint={t('passwordHint', { min: PASSWORD_MIN_LENGTH })}
        error={
          invalid
            ? t('passwordInvalid', {
                min: PASSWORD_MIN_LENGTH,
                max: PASSWORD_MAX_LENGTH,
              })
            : undefined
        }
        onChangeText={onChangeText}
      />
      <PasswordStrengthMeter password={value} />
    </View>
  );
}

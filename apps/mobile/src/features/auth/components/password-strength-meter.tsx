import { passwordStrength } from '@vozzify/contracts/auth-rules';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { AuthNotice } from './auth-field';

const levels = {
  1: { name: 'weak', color: 'bg-destructive' },
  2: { name: 'fair', color: 'bg-warning' },
  3: { name: 'strong', color: 'bg-success' },
} as const;

export function PasswordStrengthMeter({ password }: { password: string }) {
  const t = useTranslations('auth.strength');
  const strength = passwordStrength(password);
  if (strength === 0) return null;
  const { name, color } = levels[strength];
  return (
    <View className="gap-1.5">
      <View
        className="flex-row gap-1"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {[1, 2, 3].map((segment) => (
          <View
            key={segment}
            className={`h-1 flex-1 rounded-full ${segment <= strength ? color : 'bg-muted'}`}
          />
        ))}
      </View>
      <AuthNotice>{t('label', { level: t(name) })}</AuthNotice>
    </View>
  );
}

import { useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  type TextInputProps,
  View,
} from 'react-native';
import { useTranslations } from 'use-intl';
import { Text } from '../../../components/text';
import { Input } from '../../../components/ui/input';

type AuthFieldProps = TextInputProps & {
  label: string;
  error?: string;
  password?: boolean;
};

export function AuthField({
  label,
  error,
  password,
  ...props
}: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const t = useTranslations('auth');
  const toggleLabel = t(visible ? 'hidePassword' : 'showPassword');
  const toggleAccessibilityLabel = t(
    visible ? 'hidePasswordLabel' : 'showPasswordLabel',
  );
  const border = error
    ? 'border-destructive'
    : focused
      ? 'border-ring'
      : 'border-input';
  return (
    <View className="gap-1.5">
      <Text className="text-sm" weight="semibold">
        {label}
      </Text>
      <View
        className={`min-h-12 flex-row items-center rounded-full border bg-muted ${border}`}
      >
        <Input
          {...props}
          accessibilityLabel={label}
          accessibilityHint={error}
          className="min-h-12 flex-1 px-4 text-base text-foreground"
          secureTextEntry={password && !visible}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toggleAccessibilityLabel}
            className="min-h-12 justify-center px-4"
            onPress={() => {
              setVisible(!visible);
              AccessibilityInfo.announceForAccessibility(
                t(visible ? 'passwordHidden' : 'passwordVisible'),
              );
            }}
          >
            <Text className="text-sm" weight="semibold">
              {toggleLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <AuthNotice error>{error}</AuthNotice> : null}
    </View>
  );
}

export function AuthNotice({
  children,
  error,
}: {
  children: string;
  error?: boolean;
}) {
  return (
    <Text
      accessibilityRole={error ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      className={`text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {children}
    </Text>
  );
}

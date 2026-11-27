import { type ReactNode, useState } from 'react';
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
  aside?: ReactNode;
  prefix?: string;
  hint?: string;
};

export function AuthField({
  label,
  error,
  password,
  aside,
  prefix,
  hint,
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
      : 'border-transparent';
  const mono = props.keyboardType === 'number-pad';
  return (
    <View className={aside ? undefined : 'gap-1.5'}>
      <View className="flex-row items-center justify-between gap-1">
        <Text className="shrink text-[13px] leading-5" weight="semibold">
          {label}
        </Text>
        {aside}
      </View>
      <View
        className={`min-h-10 flex-row items-center rounded-full bg-muted ${border}`}
        style={{ borderWidth: 1 }}
      >
        {prefix ? (
          <Text className="pl-4 text-muted-foreground">{prefix}</Text>
        ) : null}
        <Input
          {...props}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          className={`h-[38px] flex-1 pr-4 text-base text-foreground ${prefix ? 'pl-1' : 'pl-4'} ${mono ? 'tracking-widest' : ''}`}
          mono={mono}
          secureTextEntry={password && !visible}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toggleAccessibilityLabel}
            className="h-[38px] justify-center rounded-full px-4 active:bg-accent"
            hitSlop={{ top: 1, bottom: 1 }}
            onPress={() => {
              setVisible(!visible);
              AccessibilityInfo.announceForAccessibility(
                t(visible ? 'passwordHidden' : 'passwordVisible'),
              );
            }}
          >
            <Text className="text-[13px]" weight="semibold">
              {toggleLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hint && !error ? (
        <Text className="mx-1 text-muted-foreground text-xs leading-4">
          {hint}
        </Text>
      ) : null}
      {error ? <AuthNotice error>{error}</AuthNotice> : null}
    </View>
  );
}

export function AuthNotice({
  children,
  error,
  success,
}: {
  children: string;
  error?: boolean;
  success?: boolean;
}) {
  const color = error ? 'text-destructive' : 'text-muted-foreground';
  const content = (
    <Text
      accessibilityRole={error ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      className={success ? 'text-sm leading-5' : `text-sm leading-5 ${color}`}
      weight={success ? 'semibold' : undefined}
    >
      {children}
    </Text>
  );
  return success ? (
    <View className="rounded-2xl bg-success/10 px-3 py-2">{content}</View>
  ) : (
    content
  );
}

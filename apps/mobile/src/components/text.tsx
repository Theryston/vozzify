import type { ReactNode } from 'react';
import { Text as NativeText } from 'react-native';
import { nativeFontFamilies } from '../lib/design/native-fonts';

type TextProps = {
  children: ReactNode;
  variant?: 'body' | 'heading';
  weight?: keyof typeof nativeFontFamilies;
  className?: string;
};

const variants = {
  body: 'font-sans text-base leading-6 text-foreground',
  heading: 'font-sans text-3xl font-extrabold tracking-tight text-foreground',
} as const;

export function Text({
  children,
  variant = 'body',
  weight,
  className,
}: TextProps) {
  const font = weight ?? (variant === 'heading' ? 'extrabold' : 'regular');

  return (
    <NativeText
      className={`${variants[variant]} ${className ?? ''}`}
      style={{ fontFamily: nativeFontFamilies[font] }}
    >
      {children}
    </NativeText>
  );
}

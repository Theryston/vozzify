import type { ReactNode } from 'react';
import { Text as NativeText } from 'react-native';
import { useCustomFontsAvailable } from '../lib/design/font-availability';
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
  const customFontsAvailable = useCustomFontsAvailable();
  const font = weight ?? (variant === 'heading' ? 'extrabold' : 'regular');
  const variantClassName = customFontsAvailable
    ? variants[variant]
    : variants[variant].replace('font-sans ', '');

  return (
    <NativeText
      className={`${variantClassName} ${className ?? ''}`}
      style={
        customFontsAvailable
          ? { fontFamily: nativeFontFamilies[font] }
          : undefined
      }
    >
      {children}
    </NativeText>
  );
}

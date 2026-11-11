import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { Text } from '../text';

const buttonStyles = cva(
  'min-h-10 flex-row items-center justify-center rounded-full px-5 py-3 active:opacity-90 disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary',
        secondary: 'bg-secondary',
        outline: 'border border-input bg-background',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

const labelStyles = {
  primary: 'text-sm font-semibold text-primary-foreground',
  secondary: 'text-sm font-semibold text-secondary-foreground',
  outline: 'text-sm font-semibold text-foreground',
} as const;

type ButtonProps = Omit<PressableProps, 'children'> &
  VariantProps<typeof buttonStyles> & {
    children: ReactNode;
  };

export function Button({
  children,
  className,
  variant,
  ...props
}: ButtonProps) {
  const selectedVariant = variant ?? 'primary';

  return (
    <Pressable
      className={buttonStyles({ variant, className })}
      accessibilityRole="button"
      {...props}
    >
      <Text
        className={labelStyles[selectedVariant]}
        weight={selectedVariant === 'primary' ? 'semibold' : 'medium'}
      >
        {children}
      </Text>
    </Pressable>
  );
}

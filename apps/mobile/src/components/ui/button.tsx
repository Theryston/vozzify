import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { Text } from '../text';

const buttonStyles = cva(
  'min-h-10 flex-row items-center justify-center rounded-full px-5 active:opacity-90 disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary',
        secondary: 'bg-secondary',
        outline: 'border border-input bg-background',
      },
      size: {
        medium: 'gap-2 py-0',
        large: 'py-3',
      },
    },
    defaultVariants: { variant: 'primary', size: 'large' },
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
    leading?: ReactNode;
  };

export function Button({
  children,
  className,
  leading,
  size,
  variant,
  ...props
}: ButtonProps) {
  const selectedVariant = variant ?? 'primary';

  return (
    <Pressable
      className={buttonStyles({ variant, size, className })}
      accessibilityRole="button"
      {...props}
    >
      {leading}
      <Text
        className={labelStyles[selectedVariant]}
        weight={selectedVariant === 'primary' ? 'semibold' : 'medium'}
      >
        {children}
      </Text>
    </Pressable>
  );
}

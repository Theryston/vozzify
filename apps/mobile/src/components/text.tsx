import type { ReactNode } from 'react';
import { Text as NativeText, StyleSheet } from 'react-native';

type TextProps = {
  children: ReactNode;
  variant?: 'body' | 'heading';
};

const styles = StyleSheet.create({
  body: { fontSize: 16, marginBottom: 16 },
  heading: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
});

export function Text({ children, variant = 'body' }: TextProps) {
  return <NativeText style={styles[variant]}>{children}</NativeText>;
}

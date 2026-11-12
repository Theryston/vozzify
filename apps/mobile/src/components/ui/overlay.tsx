import * as Dialog from '@rn-primitives/dialog';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useCustomFontsAvailable } from '../../lib/design/font-availability';
import { useNativeBlurTarget } from '../../lib/design/native-blur-target';
import { nativeBlurTint } from '../../lib/design/native-blur-tint';
import { nativeFontFamilies } from '../../lib/design/native-fonts';
import { Text } from '../text';
import { Button } from './button';

type OverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  dismissLabel: string;
  testID?: string;
  children: ReactNode;
};

const elevation = Platform.select({
  android: { elevation: 20 },
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
});

export function Overlay({
  open,
  onOpenChange,
  title,
  dismissLabel,
  testID,
  children,
}: OverlayProps) {
  const customFontsAvailable = useCustomFontsAvailable();
  const blurTarget = useNativeBlurTarget();
  const colorScheme = useColorScheme();
  const blurTint = nativeBlurTint(colorScheme);
  const androidBlurMethod = Platform.select({
    android: 'dimezisBlurView' as const,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="absolute inset-0">
          <BlurView
            accessible={false}
            blurMethod={androidBlurMethod}
            blurTarget={blurTarget ?? undefined}
            intensity={40}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            testID="overlay-backdrop-blur"
            tint={blurTint}
          />
          <View
            accessible={false}
            className="absolute inset-0 bg-black/40"
            pointerEvents="none"
          />
        </Dialog.Overlay>
        <Dialog.Content
          className="absolute inset-x-6 top-1/3 gap-4 rounded-2xl border border-border/60 bg-popover/70 p-dialog-padding"
          style={elevation}
        >
          <BlurView
            accessible={false}
            blurMethod={androidBlurMethod}
            blurTarget={blurTarget ?? undefined}
            intensity={55}
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: 23, margin: 1, overflow: 'hidden' },
            ]}
            testID="overlay-surface-blur"
            tint={blurTint}
          />
          <Dialog.Title
            className={`${customFontsAvailable ? 'font-sans' : ''} text-xl font-bold text-popover-foreground`}
            style={
              customFontsAvailable
                ? { fontFamily: nativeFontFamilies.bold }
                : undefined
            }
          >
            {title}
          </Dialog.Title>
          <Text className="text-popover-foreground">{children}</Text>
          <Dialog.Close asChild>
            <Button testID={testID} variant="outline">
              {dismissLabel}
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

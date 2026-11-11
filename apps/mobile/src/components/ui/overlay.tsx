import * as Dialog from '@rn-primitives/dialog';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { nativeFontFamilies } from '../../lib/design/native-fonts';
import { Text } from '../text';
import { Button } from './button';

type OverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  dismissLabel: string;
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
  children,
}: OverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="absolute inset-0 bg-black/40" />
        <Dialog.Content
          className="absolute inset-x-6 top-1/3 gap-4 rounded-2xl border border-border/60 bg-popover/90 p-dialog-padding"
          style={elevation}
        >
          <Dialog.Title
            className="font-sans text-xl font-bold text-popover-foreground"
            style={{ fontFamily: nativeFontFamilies.bold }}
          >
            {title}
          </Dialog.Title>
          <Text className="text-popover-foreground">{children}</Text>
          <Dialog.Close asChild>
            <Button variant="outline">{dismissLabel}</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

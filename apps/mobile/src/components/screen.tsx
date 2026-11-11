import { designTokens } from '@vozzify/design-tokens/native';
import type { ReactNode } from 'react';
import { ScrollView, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ScreenProps = {
  children: ReactNode;
};

export function Screen({ children }: ScreenProps) {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? 'dark' : 'light';

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: designTokens.colors[theme].background,
      }}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow gap-6 px-page-gutter-mobile py-6"
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

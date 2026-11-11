import { BlurTargetView } from 'expo-blur';
import type { ReactNode } from 'react';
import { type ComponentRef, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeBlurTargetProvider } from '../lib/design/native-blur-target';

type ScreenProps = {
  children: ReactNode;
};

export function Screen({ children }: ScreenProps) {
  const blurTargetRef = useRef<ComponentRef<typeof View> | null>(null);

  return (
    <NativeBlurTargetProvider targetRef={blurTargetRef}>
      <BlurTargetView ref={blurTargetRef} style={{ flex: 1 }}>
        <View className="flex-1 bg-background">
          <SafeAreaView style={{ flex: 1 }}>
            <ScrollView
              className="flex-1"
              contentContainerClassName="flex-grow gap-6 px-page-gutter-mobile py-6"
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </SafeAreaView>
        </View>
      </BlurTargetView>
    </NativeBlurTargetProvider>
  );
}

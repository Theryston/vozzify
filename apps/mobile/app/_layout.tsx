import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
} from '@expo-google-fonts/figtree';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import {
  MobileIntlProvider,
  type MobileLocale,
} from '../src/lib/i18n/mobile-intl-provider';

void SplashScreen.preventAutoHideAsync();

function NavigationStack() {
  const translate = useTranslations('navigation');

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerBackTitle: translate('back'),
      }}
    >
      <Stack.Screen name="index" options={{ title: translate('home') }} />
      <Stack.Screen
        name="components"
        options={{ title: translate('components') }}
      />
    </Stack>
  );
}

type RootLayoutContentProps = {
  locale?: MobileLocale;
};

export function RootLayoutContent({ locale = 'en' }: RootLayoutContentProps) {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <MobileIntlProvider locale={locale}>
        <StatusBar
          barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        />
        <NavigationStack />
        <PortalHost />
      </MobileIntlProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Figtree: Figtree_400Regular,
    'Geist Mono': GeistMono_400Regular,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
    GeistMono_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  return fontsLoaded ? <RootLayoutContent /> : null;
}

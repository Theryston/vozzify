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
import { getMobileEnv } from '../src/lib/api/mobile-env';
import { FontAvailabilityProvider } from '../src/lib/design/font-availability';
import {
  MobileIntlProvider,
  type MobileLocale,
} from '../src/lib/i18n/mobile-intl-provider';
import { MobileQueryProvider } from '../src/lib/query/mobile-query-provider';

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
  getMobileEnv();
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <MobileIntlProvider locale={locale}>
        <StatusBar
          barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        />
        <MobileQueryProvider>
          <NavigationStack />
          <PortalHost />
        </MobileQueryProvider>
      </MobileIntlProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
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
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <FontAvailabilityProvider available={fontsLoaded}>
      <RootLayoutContent />
    </FontAvailabilityProvider>
  );
}

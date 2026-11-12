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
import { NavigationBar } from 'expo-navigation-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useUniwind } from 'uniwind';
import { useTranslations } from 'use-intl';
import { getMobileEnv } from '../src/lib/api/mobile-env';
import {
  MobileAppearanceProvider,
  useMobileAppearance,
} from '../src/lib/appearance/mobile-appearance-provider';
import { FontAvailabilityProvider } from '../src/lib/design/font-availability';
import {
  MobileIntlProvider,
  type MobileLocale,
} from '../src/lib/i18n/mobile-intl-provider';
import { MobileQueryProvider } from '../src/lib/query/mobile-query-provider';

void SplashScreen.preventAutoHideAsync();

function NavigationStack({
  statusBarStyle,
}: {
  statusBarStyle: 'light' | 'dark';
}) {
  const translate = useTranslations('navigation');

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerBackTitle: translate('back'),
        contentStyle: { backgroundColor: 'transparent' },
        statusBarStyle,
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

function AppShell({ fontsReady }: { fontsReady: boolean }) {
  const { ready: appearanceReady } = useMobileAppearance();

  useEffect(() => {
    if (fontsReady && appearanceReady) {
      void SplashScreen.hideAsync();
    }
  }, [appearanceReady, fontsReady]);

  const { theme } = useUniwind();
  const statusBarStyle = theme === 'dark' ? 'light' : 'dark';

  return (
    <>
      <StatusBar
        barStyle={statusBarStyle === 'light' ? 'light-content' : 'dark-content'}
      />
      <NavigationBar style={statusBarStyle} />
      <MobileQueryProvider>
        <View className="flex-1 bg-background">
          <NavigationStack statusBarStyle={statusBarStyle} />
        </View>
        <PortalHost />
      </MobileQueryProvider>
    </>
  );
}

type RootLayoutContentProps = {
  locale?: MobileLocale;
  fontsReady?: boolean;
};

export function RootLayoutContent({
  locale = 'en',
  fontsReady = true,
}: RootLayoutContentProps) {
  getMobileEnv();

  return (
    <SafeAreaProvider>
      <MobileIntlProvider locale={locale}>
        <MobileAppearanceProvider>
          <AppShell fontsReady={fontsReady} />
        </MobileAppearanceProvider>
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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <FontAvailabilityProvider available={fontsLoaded}>
      <RootLayoutContent fontsReady={fontsLoaded || fontError !== null} />
    </FontAvailabilityProvider>
  );
}

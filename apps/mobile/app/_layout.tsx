import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import {
  MobileIntlProvider,
  type MobileLocale,
} from '../src/lib/i18n/mobile-intl-provider';

function NavigationStack() {
  const translate = useTranslations('navigation');

  return (
    <Stack screenOptions={{ headerBackTitle: translate('back') }}>
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
  return (
    <MobileIntlProvider locale={locale}>
      <NavigationStack />
    </MobileIntlProvider>
  );
}

export default function RootLayout() {
  return <RootLayoutContent />;
}

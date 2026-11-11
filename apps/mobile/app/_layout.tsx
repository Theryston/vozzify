import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { getMobileEnv } from '../src/lib/api/mobile-env';
import {
  MobileIntlProvider,
  type MobileLocale,
} from '../src/lib/i18n/mobile-intl-provider';
import { MobileQueryProvider } from '../src/lib/query/mobile-query-provider';

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
  getMobileEnv();

  return (
    <MobileIntlProvider locale={locale}>
      <MobileQueryProvider>
        <NavigationStack />
      </MobileQueryProvider>
    </MobileIntlProvider>
  );
}

export default function RootLayout() {
  return <RootLayoutContent />;
}

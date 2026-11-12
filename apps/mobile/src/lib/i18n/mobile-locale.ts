import type { MobileLocale } from './mobile-intl-provider';

export const MOBILE_LOCALE_STORAGE_KEY = 'mobile-language';

export function detectDeviceLocale(deviceLocale: string): MobileLocale {
  const language = deviceLocale
    .replaceAll('_', '-')
    .split('-')[0]
    ?.toLowerCase();

  return language === 'pt' ? 'pt-BR' : language === 'en' ? 'en' : 'en';
}

export function parseSavedLocale(value: string | null): MobileLocale | null {
  return value === 'en' || value === 'pt-BR' ? value : null;
}

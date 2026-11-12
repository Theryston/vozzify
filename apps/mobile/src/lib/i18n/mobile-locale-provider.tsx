import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { MobileLocale } from './mobile-intl-provider';
import {
  detectDeviceLocale,
  MOBILE_LOCALE_STORAGE_KEY,
  parseSavedLocale,
} from './mobile-locale';

type MobileLocaleContextValue = {
  locale: MobileLocale;
  ready: boolean;
  setLocale: (locale: MobileLocale) => void;
};

const MobileLocaleContext = createContext<MobileLocaleContextValue | null>(
  null,
);

type MobileLocaleProviderProps = {
  children: ReactNode;
  initialLocale?: MobileLocale;
};

function getDeviceLocale(): MobileLocale {
  return detectDeviceLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}

export function MobileLocaleProvider({
  children,
  initialLocale,
}: MobileLocaleProviderProps) {
  const [locale, setLocaleState] = useState(initialLocale ?? getDeviceLocale);
  const [ready, setReady] = useState(initialLocale !== undefined);

  useEffect(() => {
    if (initialLocale !== undefined) {
      return;
    }

    let active = true;
    void AsyncStorage.getItem(MOBILE_LOCALE_STORAGE_KEY)
      .then((savedValue) => {
        if (active) {
          setLocaleState(parseSavedLocale(savedValue) ?? getDeviceLocale());
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [initialLocale]);

  function setLocale(nextLocale: MobileLocale) {
    setLocaleState(nextLocale);
    void AsyncStorage.setItem(MOBILE_LOCALE_STORAGE_KEY, nextLocale).catch(
      () => undefined,
    );
  }

  return (
    <MobileLocaleContext.Provider value={{ locale, ready, setLocale }}>
      {children}
    </MobileLocaleContext.Provider>
  );
}

export function useMobileLocale() {
  const context = useContext(MobileLocaleContext);
  if (!context) {
    throw new Error('useMobileLocale must be used within MobileLocaleProvider');
  }
  return context;
}

import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

export type MobileLocale = 'en' | 'pt-BR';

type MobileIntlProviderProps = {
  children: ReactNode;
  locale?: MobileLocale;
};

const messageCatalogs = {
  en,
  'pt-BR': ptBR,
};

export function MobileIntlProvider({
  children,
  locale = 'en',
}: MobileIntlProviderProps) {
  return (
    <IntlProvider locale={locale} messages={messageCatalogs[locale]}>
      {children}
    </IntlProvider>
  );
}

import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { useTranslations } from 'use-intl';
import { MobileIntlProvider } from '../src/lib/i18n/mobile-intl-provider';
import {
  MobileLocaleProvider,
  useMobileLocale,
} from '../src/lib/i18n/mobile-locale-provider';

let mockStoredLocale: string | null = null;
let mockPendingRead: Promise<string | null> | null = null;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(
      () => mockPendingRead ?? Promise.resolve(mockStoredLocale),
    ),
    setItem: jest.fn((_key: string, value: string) => {
      mockStoredLocale = value;
      return Promise.resolve();
    }),
  },
}));

function LocaleChoice() {
  const { locale, setLocale } = useMobileLocale();
  const translate = useTranslations('home');

  return (
    <>
      <Text>{translate('title')}</Text>
      <Pressable
        accessibilityLabel="Choose Brazilian Portuguese"
        accessibilityRole="button"
        onPress={() => setLocale('pt-BR')}
        testID="choose-portuguese"
      >
        <Text>{locale}</Text>
      </Pressable>
    </>
  );
}

function LocaleApp() {
  const { locale } = useMobileLocale();

  return (
    <MobileIntlProvider locale={locale}>
      <LocaleChoice />
    </MobileIntlProvider>
  );
}

describe('mobile locale preference', () => {
  beforeEach(() => {
    mockStoredLocale = null;
    mockPendingRead = null;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('detects a supported device language when no preference is saved', async () => {
    jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ locale: 'pt-BR' }),
    } as Intl.DateTimeFormat);

    await render(
      <MobileLocaleProvider>
        <LocaleApp />
      </MobileLocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Boas-vindas ao Vozzify')).toBeOnTheScreen();
    });
  });

  it('persists a manual choice and restores the translated screen after restart', async () => {
    mockStoredLocale = 'en';
    const firstLaunch = await render(
      <MobileLocaleProvider>
        <LocaleApp />
      </MobileLocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Welcome to Vozzify')).toBeOnTheScreen();
    });
    await userEvent.press(screen.getByTestId('choose-portuguese'));
    await waitFor(() => {
      expect(screen.getByText('Boas-vindas ao Vozzify')).toBeOnTheScreen();
    });
    expect(mockStoredLocale).toBe('pt-BR');

    await firstLaunch.unmount();
    await render(
      <MobileLocaleProvider>
        <LocaleApp />
      </MobileLocaleProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Boas-vindas ao Vozzify')).toBeOnTheScreen();
    });
  });

  it('keeps a manual choice made while the initial preference read is pending', async () => {
    let resolveRead: ((value: string | null) => void) | undefined;
    mockPendingRead = new Promise((resolve) => {
      resolveRead = resolve;
    });

    await render(
      <MobileLocaleProvider>
        <LocaleApp />
      </MobileLocaleProvider>,
    );
    await userEvent.press(screen.getByTestId('choose-portuguese'));
    await waitFor(() => {
      expect(screen.getByText('Boas-vindas ao Vozzify')).toBeOnTheScreen();
    });

    if (!resolveRead) {
      throw new Error('The initial preference read did not start');
    }
    resolveRead('en');

    await waitFor(() => {
      expect(screen.getByText('Boas-vindas ao Vozzify')).toBeOnTheScreen();
      expect(mockStoredLocale).toBe('pt-BR');
    });
  });
});

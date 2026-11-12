import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import {
  MobileLocaleProvider,
  useMobileLocale,
} from '../src/lib/i18n/mobile-locale-provider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

function LocaleChoice() {
  const { locale, setLocale } = useMobileLocale();

  return (
    <Pressable
      accessibilityLabel={locale}
      accessibilityRole="button"
      onPress={() => setLocale('pt-BR')}
      testID="choose-portuguese"
    >
      <Text>{locale}</Text>
    </Pressable>
  );
}

describe('mobile locale preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  });

  it('restores a saved language and persists a new manual choice', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('en');
    const firstLaunch = await render(
      <MobileLocaleProvider>
        <LocaleChoice />
      </MobileLocaleProvider>,
    );

    await waitFor(() => expect(screen.getByText('en')).toBeOnTheScreen());
    await userEvent.press(screen.getByTestId('choose-portuguese'));

    await waitFor(() => expect(screen.getByText('pt-BR')).toBeOnTheScreen());
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'mobile-language',
      'pt-BR',
    );

    await firstLaunch.unmount();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('pt-BR');
    await render(
      <MobileLocaleProvider>
        <LocaleChoice />
      </MobileLocaleProvider>,
    );
    await waitFor(() => expect(screen.getByText('pt-BR')).toBeOnTheScreen());
  });

  it('uses an injected locale without waiting for storage', async () => {
    await render(
      <MobileLocaleProvider initialLocale="pt-BR">
        <LocaleChoice />
      </MobileLocaleProvider>,
    );

    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});

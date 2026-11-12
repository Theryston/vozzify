import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { Appearance, Text } from 'react-native';
import { Uniwind, useUniwind } from 'uniwind';
import { AppearancePreferenceControl } from '../src/components/appearance-preference-control';
import { MobileAppearanceProvider } from '../src/lib/appearance/mobile-appearance-provider';
import { MobileIntlProvider } from '../src/lib/i18n/mobile-intl-provider';

function ThemeProbe() {
  const { theme } = useUniwind();
  return <Text testID="active-theme">{theme}</Text>;
}

async function renderAppearanceControl() {
  return render(
    <MobileIntlProvider locale="en">
      <MobileAppearanceProvider>
        <AppearancePreferenceControl />
        <ThemeProbe />
      </MobileAppearanceProvider>
    </MobileIntlProvider>,
  );
}

describe('appearance preference', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    Uniwind.setTheme('system');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts in system mode and restores a manually selected preference', async () => {
    const firstLaunch = await renderAppearanceControl();

    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'System' }).props.accessibilityState,
      ).toEqual({ checked: true });
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'Dark' }).props.accessibilityState,
      ).toEqual({ checked: true });
    });

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
    expect(
      screen.getByRole('radio', { name: 'Dark' }).props.className,
    ).toContain('bg-primary');
    expect(
      screen.getByRole('radio', { name: 'System' }).props.className,
    ).toContain('bg-background');

    await firstLaunch.unmount();
    await renderAppearanceControl();

    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'Dark' }).props.accessibilityState,
      ).toEqual({ checked: true });
    });
  });

  it('switches between fixed themes and follows the system again on request', async () => {
    Uniwind.setTheme('system');
    const setColorScheme = jest.spyOn(Uniwind, 'setTheme');
    await renderAppearanceControl();

    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('system');
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('light');
      expect(screen.getByTestId('active-theme')).toHaveTextContent('light');
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('dark');
      expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => {
      expect(screen.getByTestId('active-theme')).toHaveTextContent('light');
    });

    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    await userEvent.press(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('system');
      expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
    });
  });

  it('applies a restored theme before a delayed native appearance update', async () => {
    await AsyncStorage.setItem('vozzify.appearance', 'dark');
    jest.spyOn(Uniwind, 'setTheme');
    const delayedNativeUpdate = jest
      .spyOn(Appearance, 'setColorScheme')
      .mockImplementation(() => undefined);

    await renderAppearanceControl();

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
    expect(Uniwind.setTheme).toHaveBeenCalledWith('dark');
    expect(delayedNativeUpdate).toHaveBeenCalledWith('dark');
  });
});

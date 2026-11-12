import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { Appearance } from 'react-native';
import { AppearancePreferenceControl } from '../src/components/appearance-preference-control';
import { MobileAppearanceProvider } from '../src/lib/appearance/mobile-appearance-provider';
import { MobileIntlProvider } from '../src/lib/i18n/mobile-intl-provider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual<
    typeof import('@react-native-async-storage/async-storage/jest')
  >('@react-native-async-storage/async-storage/jest').default,
}));

async function renderAppearanceControl() {
  return render(
    <MobileIntlProvider locale="en">
      <MobileAppearanceProvider>
        <AppearancePreferenceControl />
      </MobileAppearanceProvider>
    </MobileIntlProvider>,
  );
}

describe('appearance preference', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
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

    await firstLaunch.unmount();
    await renderAppearanceControl();

    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'Dark' }).props.accessibilityState,
      ).toEqual({ checked: true });
    });
  });

  it('switches between fixed themes and follows the system again on request', async () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme');
    await renderAppearanceControl();

    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('auto');
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('light');
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('dark');
    });

    await userEvent.press(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => {
      expect(setColorScheme).toHaveBeenLastCalledWith('auto');
    });
  });
});

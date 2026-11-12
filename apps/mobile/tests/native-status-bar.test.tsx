import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { Uniwind } from 'uniwind';
import { RootLayoutContent } from '../app/_layout';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text: NativeText, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const { AppearancePreferenceControl } = jest.requireActual<
    typeof import('../src/components/appearance-preference-control')
  >('../src/components/appearance-preference-control');

  const Stack = Object.assign(
    ({
      screenOptions,
      children,
    }: {
      screenOptions: { statusBarStyle?: string };
      children: React.ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        React.createElement(
          NativeText,
          { testID: 'native-stack-status-bar-style' },
          screenOptions.statusBarStyle,
        ),
        React.createElement(AppearancePreferenceControl),
        children,
      ),
    { Screen: () => null },
  );

  return {
    Link: ({ children }: { children: React.ReactNode }) => children,
    Stack,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock(
  'react-native/Libraries/Utilities/Appearance',
  () =>
    jest.requireActual<typeof import('./helpers/controlled-appearance')>(
      './helpers/controlled-appearance',
    ).controlledAppearance,
);

import { controlledAppearance } from './helpers/controlled-appearance';

describe('native status bar appearance', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await act(async () => {
      controlledAppearance.emitAppearanceChange('light');
    });
    Uniwind.setTheme('system');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sets native stack icons from the app theme and follows System changes', async () => {
    await render(<RootLayoutContent />);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => {
      expect(
        screen.getByTestId('native-stack-status-bar-style'),
      ).toHaveTextContent('light');
    });

    await act(async () => {
      controlledAppearance.emitAppearanceChange('light');
    });
    expect(
      screen.getByTestId('native-stack-status-bar-style'),
    ).toHaveTextContent('light');

    await userEvent.press(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => {
      expect(
        screen.getByTestId('native-stack-status-bar-style'),
      ).toHaveTextContent('dark');
    });

    await act(async () => {
      controlledAppearance.emitAppearanceChange('dark');
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('native-stack-status-bar-style'),
      ).toHaveTextContent('light');
    });

    await userEvent.press(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => {
      expect(
        screen.getByTestId('native-stack-status-bar-style'),
      ).toHaveTextContent('dark');
    });
  });
});

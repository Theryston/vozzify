import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { RootLayoutContent } from '../app/_layout';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const Stack = Object.assign(
    ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
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

jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn(() => Promise.resolve()),
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
}));

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function renderWithPendingRestores(fontsReady: boolean) {
  const localeRead = createDeferred<string | null>();
  const appearanceRead = createDeferred<string | null>();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation((key) =>
      key === 'mobile-language' ? localeRead.promise : appearanceRead.promise,
    );

  const app = await render(
    <RootLayoutContent detectDeviceLocale fontsReady={fontsReady} />,
  );

  await waitFor(() => {
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('mobile-language');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('vozzify.appearance');
  });

  return { app, appearanceRead, localeRead };
}

describe('mobile startup readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits for fonts after appearance and locale are ready', async () => {
    const { app, appearanceRead, localeRead } =
      await renderWithPendingRestores(false);

    await act(async () => {
      localeRead.resolve('pt-BR');
      appearanceRead.resolve('dark');
    });
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await app.rerender(<RootLayoutContent detectDeviceLocale fontsReady />);
    await waitFor(() => {
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('waits for locale after fonts and appearance are ready', async () => {
    const { appearanceRead, localeRead } =
      await renderWithPendingRestores(true);

    await act(async () => {
      appearanceRead.resolve('system');
    });
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await act(async () => {
      localeRead.resolve('pt-BR');
    });
    await waitFor(() => {
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('waits for appearance after fonts and locale are ready', async () => {
    const { appearanceRead, localeRead } =
      await renderWithPendingRestores(true);

    await act(async () => {
      localeRead.resolve('pt-BR');
    });
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await act(async () => {
      appearanceRead.resolve('dark');
    });
    await waitFor(() => {
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });
  });
});

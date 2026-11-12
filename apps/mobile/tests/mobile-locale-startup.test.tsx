import AsyncStorage from '@react-native-async-storage/async-storage';
import { screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as SplashScreen from 'expo-splash-screen';
import { RootLayoutContent } from '../app/_layout';
import ComponentsScreen from '../app/components';
import HomeScreen from '../app/index';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));
jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn(() => Promise.resolve()),
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
}));

describe('mobile locale startup', () => {
  it('restores the selected catalog before releasing the splash screen', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('pt-BR');

    await renderRouter({
      _layout: () => <RootLayoutContent detectDeviceLocale />,
      components: ComponentsScreen,
      index: HomeScreen,
    });

    await waitFor(() => {
      expect(screen.getByText('Boas-vindas ao Vozzify')).toBeOnTheScreen();
      expect(SplashScreen.hideAsync).toHaveBeenCalled();
    });
  });
});

import { screen, waitFor } from '@testing-library/react-native';
import { useFonts } from 'expo-font';
import { renderRouter } from 'expo-router/testing-library';
import * as SplashScreen from 'expo-splash-screen';
import RootLayout from '../app/_layout';
import ComponentsScreen from '../app/components';
import HomeScreen from '../app/index';

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn(() => Promise.resolve()),
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
}));

describe('font startup fallback', () => {
  it('renders with system fonts and hides the splash when font loading fails', async () => {
    jest
      .mocked(useFonts)
      .mockReturnValue([false, new Error('font unavailable')]);

    await renderRouter({
      _layout: RootLayout,
      components: ComponentsScreen,
      index: HomeScreen,
    });

    const heading = screen.getByText('Welcome to Vozzify');
    expect(heading.props.className).not.toContain('font-sans');
    expect(heading.props.style).toBeUndefined();
    await waitFor(() => expect(SplashScreen.hideAsync).toHaveBeenCalled());
  });
});

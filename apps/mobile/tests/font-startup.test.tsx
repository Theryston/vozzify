import { screen, userEvent, waitFor } from '@testing-library/react-native';
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

    await userEvent.press(screen.getByTestId('open-components'));

    const input = screen.getByTestId('gallery-input');
    expect(input.props.className).not.toContain('font-sans');
    expect(input.props.style).toBeUndefined();

    await userEvent.press(screen.getByRole('button', { name: 'Open overlay' }));

    const title = screen.getByText('A native overlay');
    expect(title.props.className).not.toContain('font-sans');
    expect(title.props.style).toBeUndefined();
  });
});

import { userEvent } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

describe('filesystem routes', () => {
  it('opens the production app shell and follows its visible navigation', async () => {
    const router = await renderRouter('./app');

    expect(screen.getByText('Welcome to Vozzify')).toBeOnTheScreen();
    await userEvent.press(screen.getByTestId('open-components'));
    expect(screen.getByText('Foundation components')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/components');
  });
});

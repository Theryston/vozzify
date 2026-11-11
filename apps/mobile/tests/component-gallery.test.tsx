import { screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { RootLayoutContent } from '../app/_layout';
import ComponentsScreen from '../app/components';
import HomeScreen from '../app/index';

describe('native component gallery', () => {
  it('accepts text and opens and dismisses the themed overlay', async () => {
    await renderRouter(
      {
        _layout: () => <RootLayoutContent />,
        index: HomeScreen,
        components: ComponentsScreen,
      },
      { initialUrl: '/components' },
    );

    const input = screen.getByTestId('gallery-input');
    await userEvent.type(input, 'Figtree');
    expect(input.props.value).toBe('Figtree');

    await userEvent.press(screen.getByRole('button', { name: 'Open overlay' }));
    expect(
      screen.getByText(
        'This surface uses the same palette and rounded shapes as the app.',
      ),
    ).toBeOnTheScreen();

    await userEvent.press(
      screen.getByRole('button', { name: 'Dismiss overlay' }),
    );
    expect(
      screen.queryByText(
        'This surface uses the same palette and rounded shapes as the app.',
      ),
    ).toBeNull();
  });
});

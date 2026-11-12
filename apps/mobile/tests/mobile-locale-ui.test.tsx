import { screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { RootLayoutContent } from '../app/_layout';
import ComponentsScreen from '../app/components';
import HomeScreen from '../app/index';

describe('gallery language preference', () => {
  it('changes accessible language choices and gallery copy', async () => {
    await renderRouter({
      _layout: () => <RootLayoutContent locale="en" />,
      index: HomeScreen,
      components: ComponentsScreen,
    });

    await userEvent.press(screen.getByTestId('open-components'));
    expect(screen.getByText('Foundation components')).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', { name: 'Brazilian Portuguese' }).props
        .accessibilityState,
    ).toEqual({ selected: false });

    await userEvent.press(screen.getByTestId('language-pt-BR'));

    expect(screen.getByText('Componentes da base')).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', { name: 'Português do Brasil' }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  });
});

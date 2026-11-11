import { screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { RootLayoutContent } from '../app/_layout';
import ComponentsScreen from '../app/components';
import HomeScreen from '../app/index';

describe('foundation navigation', () => {
  it('shows shell copy and navigates between foundation screens', async () => {
    await renderRouter({
      _layout: () => <RootLayoutContent />,
      index: HomeScreen,
      components: ComponentsScreen,
    });

    expect(screen.getByText('Welcome to Vozzify')).toBeOnTheScreen();
    await userEvent.press(screen.getByTestId('open-components'));
    expect(screen.getByText('Foundation components')).toBeOnTheScreen();

    await userEvent.press(screen.getByTestId('return-home'));
    expect(screen.getByText('Welcome to Vozzify')).toBeOnTheScreen();
  });

  it('renders shell copy from the Brazilian Portuguese catalog', async () => {
    await renderRouter({
      _layout: () => <RootLayoutContent locale="pt-BR" />,
      index: HomeScreen,
      components: ComponentsScreen,
    });

    expect(screen.getByText('Boas-vindas ao Vozzify')).toBeOnTheScreen();
    expect(screen.getByText('Abrir galeria de componentes')).toBeOnTheScreen();
  });
});

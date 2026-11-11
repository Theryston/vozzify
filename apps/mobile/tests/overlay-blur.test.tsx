import { screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as ReactNative from 'react-native';
import { RootLayoutContent } from '../app/_layout';
import ComponentsScreen from '../app/components';
import HomeScreen from '../app/index';
import { nativeBlurTint } from '../src/lib/design/native-blur-tint';

describe('native dialog backdrop', () => {
  it.each([
    ['light', 'systemMaterialLight'],
    ['dark', 'systemMaterialDark'],
    [null, 'systemMaterialLight'],
  ] as const)('uses the %s material tint', (colorScheme, expectedTint) => {
    expect(nativeBlurTint(colorScheme)).toBe(expectedTint);
  });

  it('blurs the active screen behind the dialog and preserves dismissal', async () => {
    const platformSelect = jest.spyOn(ReactNative.Platform, 'select');
    platformSelect.mockImplementation((specifics) => {
      if ('android' in specifics) {
        return specifics.android;
      }
      if ('native' in specifics) {
        return specifics.native;
      }
      return undefined;
    });

    try {
      await renderRouter(
        {
          _layout: () => <RootLayoutContent />,
          index: HomeScreen,
          components: ComponentsScreen,
        },
        { initialUrl: '/components' },
      );

      await userEvent.press(
        screen.getByRole('button', { name: 'Open overlay' }),
      );

      const backdrop = screen.getByTestId('overlay-backdrop-blur', {
        includeHiddenElements: true,
      });
      const surface = screen.getByTestId('overlay-surface-blur', {
        includeHiddenElements: true,
      });
      expect(backdrop.props.blurTarget).toEqual(
        expect.objectContaining({ current: expect.anything() }),
      );
      expect(surface.props.blurTarget).toBe(backdrop.props.blurTarget);
      expect(backdrop.props.blurMethod).toBe('dimezisBlurView');
      expect(
        screen.getByRole('button', { name: 'Dismiss overlay' }),
      ).toBeOnTheScreen();
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
    } finally {
      platformSelect.mockRestore();
    }
  });
});

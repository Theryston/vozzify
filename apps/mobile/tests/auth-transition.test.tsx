import { screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Platform } from 'react-native';

import '../app/_layout';

async function expectOpaqueAuthSurface(title: string) {
  const surface = await screen.findByTestId('auth-screen-surface');
  expect(surface).toHaveProp('className', 'flex-1 bg-background');
  expect(
    within(surface).getByRole('header', { name: title }),
  ).toBeOnTheScreen();
}

it('covers the full scene behind both credential forms during replacement', async () => {
  await renderRouter('./app', { initialUrl: '/sign-up' });
  await expectOpaqueAuthSurface('Create your account');

  await userEvent.press(screen.getByRole('link', { name: 'Sign in' }));
  await screen.findByRole('header', { name: 'Sign in' });
  await expectOpaqueAuthSurface('Sign in');
});

it('switches credential screens without a native animation on Android', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    await renderRouter('./app', { initialUrl: '/sign-up' });
    await userEvent.press(await screen.findByRole('link', { name: 'Sign in' }));
    const heading = await screen.findByRole('header', { name: 'Sign in' });
    let scene = heading.parent;
    while (scene && scene.props.stackAnimation === undefined) {
      scene = scene.parent;
    }
    expect(scene).toHaveProp('stackAnimation', 'none');
  } finally {
    platform.restore();
  }
});

import { focusManager, onlineManager, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ComponentType, ReactNode } from 'react';
import { Text } from 'react-native';
import { z } from 'zod';

import { RootLayoutContent } from '../app/_layout';
import { mobileApi } from '../src/lib/api/mobile-api';

let mockPortalConsumer: ComponentType | null = null;

jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  const { Portal } =
    require('@rn-primitives/portal') as typeof import('@rn-primitives/portal');

  function MockStack({ children }: { children?: ReactNode }) {
    return (
      <>
        <Portal name="root-query-consumer">
          {mockPortalConsumer === null
            ? null
            : React.createElement(mockPortalConsumer)}
        </Portal>
        {children}
      </>
    );
  }
  MockStack.Screen = () => null;
  return { Stack: MockStack };
});

jest.mock('../src/lib/api/mobile-env', () => ({
  getMobileEnv: () => ({ apiBaseUrl: 'http://10.0.2.2:3333' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const responseSchema = z.object({ message: z.string() });

function PortalQueryConsumer() {
  const { data } = useQuery({
    queryKey: ['root-portal-api'],
    queryFn: ({ signal }) =>
      mobileApi('/root-portal-test', { schema: responseSchema, signal }),
  });
  return <Text>{data?.message ?? 'Loading portal API data'}</Text>;
}

describe('root query portal composition', () => {
  beforeEach(() => {
    mockPortalConsumer = PortalQueryConsumer;
    onlineManager.setOnline(true);
    focusManager.setFocused(true);
  });

  afterEach(() => {
    mockPortalConsumer = null;
    jest.restoreAllMocks();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it('keeps API query context available to children hosted through the native portal', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Portal API data loaded' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const view = await render(<RootLayoutContent />);

    expect(await screen.findByText('Portal API data loaded')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://10.0.2.2:3333/v1/root-portal-test'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await view.unmount();
  });
});

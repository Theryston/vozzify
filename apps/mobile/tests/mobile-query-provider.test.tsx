import { focusManager, onlineManager, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { AppState, type AppStateStatus, Text } from 'react-native';
import { z } from 'zod';

import { mobileApi } from '../src/lib/api/mobile-api';
import { MobileQueryProvider } from '../src/lib/query/mobile-query-provider';

let mockNetworkIsOnline = true;
const mockNetworkListeners: Array<
  (state: { isConnected: boolean; isInternetReachable: boolean }) => void
> = [];

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockImplementation(() =>
    Promise.resolve({
      isConnected: mockNetworkIsOnline,
      isInternetReachable: mockNetworkIsOnline,
    }),
  ),
  addNetworkStateListener: jest.fn((listener) => {
    mockNetworkListeners.push(listener);
    return { remove: jest.fn() };
  }),
}));

jest.mock('../src/lib/api/mobile-env', () => ({
  getMobileEnv: () => ({ apiBaseUrl: 'http://10.0.2.2:3333' }),
}));

const testResponseSchema = z.object({ message: z.string() });

function QueryConsumer() {
  const { data } = useQuery({
    queryKey: ['test-consumer'],
    staleTime: 0,
    queryFn: ({ signal }) =>
      mobileApi('/query-test', { schema: testResponseSchema, signal }),
  });
  return <Text>{data?.message ?? 'Loading API data'}</Text>;
}

function TestTree({ children }: { children: ReactNode }) {
  return <MobileQueryProvider>{children}</MobileQueryProvider>;
}

const apiResponse = () =>
  new Response(JSON.stringify({ message: 'API data loaded' }), {
    headers: { 'content-type': 'application/json' },
  });

describe('mobile query provider', () => {
  beforeEach(() => {
    mockNetworkListeners.length = 0;
    mockNetworkIsOnline = true;
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it('pauses a test consumer offline and resumes its API request on reconnection', async () => {
    mockNetworkIsOnline = false;
    onlineManager.setOnline(false);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(apiResponse());
    const view = await render(
      <TestTree>
        <QueryConsumer />
      </TestTree>,
    );

    await waitFor(() => expect(mockNetworkListeners).toHaveLength(1));
    expect(fetchMock).not.toHaveBeenCalled();
    mockNetworkIsOnline = true;
    mockNetworkListeners[0]?.({
      isConnected: true,
      isInternetReachable: true,
    });

    expect(await screen.findByText('API data loaded')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://10.0.2.2:3333/v1/query-test'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    mockNetworkListeners[0]?.({
      isConnected: false,
      isInternetReachable: false,
    });
    await waitFor(() => expect(onlineManager.isOnline()).toBe(false));
    await view.unmount();
  });

  it('refetches stale API data when the app returns to the foreground', async () => {
    let onChange: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_, listener) => {
        onChange = listener;
        return { remove };
      });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => Promise.resolve(apiResponse()));
    const view = await render(
      <StrictMode>
        <TestTree>
          <QueryConsumer />
        </TestTree>
      </StrictMode>,
    );

    expect(await screen.findByText('API data loaded')).toBeOnTheScreen();
    await waitFor(() => expect(onChange).toBeDefined());
    const callsBeforeForeground = fetchMock.mock.calls.length;
    onChange?.('background');
    onChange?.('active');

    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(
        callsBeforeForeground,
      ),
    );
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('cancels an in-flight API request when the provider unmounts', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      });
    const view = await render(
      <TestTree>
        <QueryConsumer />
      </TestTree>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await view.unmount();

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
  });
});

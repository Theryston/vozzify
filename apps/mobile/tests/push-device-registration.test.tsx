import { onlineManager } from '@tanstack/react-query';
import {
  act,
  renderHook,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {
  type SyncPushDeviceBody,
  syncPushDeviceBodySchema,
} from '@vozzify/contracts';
import * as Notifications from 'expo-notifications';
import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import '../app/_layout';
import { createAppConfig } from '../app.config';
import type { PushContext } from '../src/lib/push/reconcile-push-device';
import { usePushDeviceRegistration } from '../src/lib/push/use-push-device-registration';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3, EPHEMERAL: 4 },
  addPushTokenListener: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (length: number) =>
    new Uint8Array(length).fill(12),
  randomUUID: () => '2565ee17-1ef7-4b50-be40-536a19cb6a68',
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const granted = {
  granted: true,
  status: 'granted',
  canAskAgain: true,
  expires: 'never',
} as Notifications.NotificationPermissionsStatus;
const denied = {
  ...granted,
  granted: false,
  status: 'denied',
} as Notifications.NotificationPermissionsStatus;
const undetermined = {
  ...denied,
  status: 'undetermined',
} as Notifications.NotificationPermissionsStatus;
const readPermission = jest.mocked(Notifications.getPermissionsAsync);
const requestPermission = jest.mocked(Notifications.requestPermissionsAsync);
const getToken = jest.mocked(Notifications.getDevicePushTokenAsync);
const listenToTokens = jest.mocked(Notifications.addPushTokenListener);
let request: jest.SpiedFunction<typeof fetch>;

const firstUser = {
  id: 'user-1',
  email: 'ana@example.com',
  emailVerified: true,
  username: 'ana',
};
const allAppStateListeners = new Set<(state: AppStateStatus) => void>();
const allTokenListeners = new Set<Notifications.PushTokenListener>();

function json(data: unknown) {
  return new Response(JSON.stringify(data));
}

function noContent() {
  return new Response(null, { status: 204 });
}

function deferred<T>() {
  let resolve: (result: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

function setAppState(state: AppStateStatus) {
  AppState.currentState = state;
  for (const listener of allAppStateListeners) listener(state);
}

async function foreground() {
  await act(() => {
    setAppState('background');
    setAppState('active');
  });
}

function posted(): Array<{
  body: SyncPushDeviceBody;
  authorization: string | null;
  signal?: AbortSignal | null;
}> {
  return request.mock.calls.flatMap(([input, init]) => {
    if (!String(input).endsWith('/v1/me/push-devices')) return [];
    return [
      {
        body: syncPushDeviceBodySchema.parse(JSON.parse(String(init?.body))),
        authorization: new Headers(init?.headers).get('authorization'),
        signal: init?.signal,
      },
    ];
  });
}

beforeEach(() => {
  const values = new Map<string, string>();
  jest
    .spyOn(SecureStore, 'getItemAsync')
    .mockImplementation(async (key) => values.get(key) ?? null);
  jest
    .spyOn(SecureStore, 'setItemAsync')
    .mockImplementation(async (key, value) => {
      values.set(key, value);
    });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      allAppStateListeners.add(listener);
      return { remove: () => allAppStateListeners.delete(listener) };
    });
  AppState.currentState = 'active';
  jest.replaceProperty(Platform, 'OS', 'ios');
  onlineManager.setOnline(true);
  request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => noContent());
  readPermission.mockReset().mockResolvedValue(granted);
  requestPermission.mockReset().mockResolvedValue(granted);
  getToken
    .mockReset()
    .mockResolvedValue({ data: 'provider-token', type: 'ios' });
  listenToTokens.mockImplementation((listener) => {
    allTokenListeners.add(listener);
    return { remove: () => allTokenListeners.delete(listener) };
  });
});

afterEach(() => {
  request.mockReset();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('waits for an eligible User to arrive at their Gallery destination before showing the system prompt', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue('35');
  // A fresh Android 13+ install can be reported as denied but askable.
  readPermission.mockResolvedValue(denied);
  const prompt = deferred<Notifications.NotificationPermissionsStatus>();
  let galleryVisibleAtPrompt = false;
  requestPermission.mockImplementation(() => {
    galleryVisibleAtPrompt =
      screen.queryByText('Foundation components') !== null &&
      screen.queryByText('Choose your Username') === null;
    return prompt.promise;
  });
  await SecureStore.setItemAsync(
    'vozzify.auth',
    JSON.stringify({
      token: 'signed.session',
      continuation: { destination: '/components' },
    }),
  );
  request.mockImplementation(async (input) => {
    if (String(input).endsWith('/auth/get-session')) {
      return json({ user: { ...firstUser, username: null } });
    }
    if (String(input).includes('/username/availability')) {
      return json({ available: true });
    }
    return json({
      ...firstUser,
      name: 'Ana',
      image: null,
      role: 'USER',
      createdAt: '2026-11-26T00:00:00Z',
    });
  });
  const router = await renderRouter('./app');
  expect(await screen.findByText('Choose your Username')).toBeOnTheScreen();
  expect(requestPermission).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Username'), 'ana');
  await userEvent.press(screen.getByTestId('submit-username'));
  await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  expect(router.getPathname()).toBe('/components');
  expect(galleryVisibleAtPrompt).toBe(true);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
    'vozzify',
    expect.objectContaining({ importance: 3 }),
  );
  await act(() => prompt.resolve(denied));
  await foreground();
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(2));
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(posted()).toEqual([]);
  await userEvent.press(screen.getByTestId('return-home'));
  expect(await screen.findByText('Signed in as @ana')).toBeOnTheScreen();
});

it('registers after a first grant on Home and restores without prompting again', async () => {
  readPermission.mockResolvedValueOnce(undetermined);
  await SecureStore.setItemAsync(
    'vozzify.auth',
    JSON.stringify({ token: 'signed.session' }),
  );
  request.mockImplementation(async (url) =>
    String(url).endsWith('/auth/get-session')
      ? json({ user: firstUser })
      : noContent(),
  );
  const router = await renderRouter('./app');
  expect(await screen.findByText('Signed in as @ana')).toBeOnTheScreen();
  await waitFor(() => expect(posted()).toHaveLength(1));
  expect(posted()[0]).toMatchObject({
    authorization: 'Bearer signed.session',
    body: {
      active: true,
      revision: 1,
      platform: 'ios',
      token: 'provider-token',
    },
  });
  expect(requestPermission).toHaveBeenCalledTimes(1);
  await router.unmount();
  await renderRouter('./app');
  await waitFor(() => expect(posted()).toHaveLength(2));
  expect(posted()[1]?.body).toMatchObject({
    ...posted()[0]?.body,
    revision: 2,
  });
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

it('retries a failed write on reconnect and deactivates with an API reachable on unvalidated internet', async () => {
  onlineManager.setOnline(false);
  readPermission.mockResolvedValueOnce({ ...denied, canAskAgain: false });
  await renderHook(() =>
    usePushDeviceRegistration(firstUser.id, 'first.session', 'arrived'),
  );
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(1));
  expect(requestPermission).not.toHaveBeenCalled();
  expect(getToken).not.toHaveBeenCalled();

  request.mockRejectedValueOnce(new Error('Connection unavailable'));
  await foreground();
  await waitFor(() => expect(posted()[0]?.body.active).toBe(true));

  await act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(posted()[1]?.body.active).toBe(true));
  expect(posted()[1]?.body.revision).toBeGreaterThan(
    posted()[0]?.body.revision ?? 0,
  );

  await act(() => onlineManager.setOnline(false));
  readPermission.mockResolvedValue({ ...denied, granted: true });
  await foreground();
  await waitFor(() => expect(posted()[2]?.body.active).toBe(false));
  expect(posted()[2]?.body.revision).toBeGreaterThan(
    posted()[1]?.body.revision ?? 0,
  );
  expect(requestPermission).not.toHaveBeenCalled();

  readPermission.mockResolvedValue(granted);
  await foreground();
  await waitFor(() => expect(posted()[3]?.body.active).toBe(true));
});

it('retries a native prompt error while the OS still has no decision, then registers after a grant', async () => {
  jest.useFakeTimers();
  readPermission.mockResolvedValue(undetermined);
  requestPermission.mockRejectedValueOnce(new Error('Activity unavailable'));
  await renderHook(() =>
    usePushDeviceRegistration(firstUser.id, 'first.session', 'arrived'),
  );
  await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  await act(() => jest.advanceTimersByTimeAsync(2_000));
  await waitFor(() => expect(posted()[0]?.body.active).toBe(true));
  expect(requestPermission).toHaveBeenCalledTimes(2);
  expect(readPermission).toHaveBeenCalledTimes(3);
});

it('honours the system denial when permission changes during a failed native request', async () => {
  jest.useFakeTimers();
  readPermission.mockResolvedValueOnce(undetermined).mockResolvedValue(denied);
  requestPermission.mockRejectedValueOnce(
    new Error('Interrupted permission response'),
  );
  await renderHook(() =>
    usePushDeviceRegistration(firstUser.id, 'first.session', 'arrived'),
  );
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(2));
  await act(() => jest.advanceTimersByTimeAsync(10_000));
  await foreground();
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(3));
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(posted()).toHaveLength(0);
});

async function restoreAfterInterruptedPrompt() {
  // A new process has the durable reservation but no in-flight native call.
  await SecureStore.setItemAsync(
    'vozzify.push-installation',
    JSON.stringify({
      installationId: '2565ee17-1ef7-4b50-be40-536a19cb6a68',
      installationSecret: '0c'.repeat(32),
      revision: 0,
      permission: 'pending',
    }),
  );
  return renderHook(() =>
    usePushDeviceRegistration(firstUser.id, 'first.session', 'arrived'),
  );
}

it('recovers after the app died during a prompt if iOS still has no decision', async () => {
  readPermission.mockResolvedValue(undetermined);
  await restoreAfterInterruptedPrompt();
  await waitFor(() => expect(posted()[0]?.body.active).toBe(true));
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

it('does not repeat an interrupted prompt if Android reports a possibly final refusal', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue('35');
  readPermission.mockResolvedValue(denied);
  await restoreAfterInterruptedPrompt();
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(1));
  await foreground();
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(2));
  expect(requestPermission).not.toHaveBeenCalled();
  expect(posted()).toHaveLength(0);
});

it('ignores a delayed prompt grant when the current foreground permission is denied', async () => {
  readPermission.mockResolvedValue(undetermined);
  const prompt = deferred<Notifications.NotificationPermissionsStatus>();
  requestPermission.mockReturnValue(prompt.promise);
  await renderHook(() =>
    usePushDeviceRegistration(firstUser.id, 'first.session', 'arrived'),
  );
  await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));

  readPermission.mockResolvedValue(denied);
  await foreground();
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(2));
  await act(() => prompt.resolve(granted));
  await waitFor(() => expect(readPermission).toHaveBeenCalledTimes(3));
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(posted()).toHaveLength(0);
});

it('does not re-register when a native token read resolves after permission was revoked', async () => {
  const token = deferred<Notifications.DevicePushToken>();
  getToken
    .mockResolvedValueOnce({ data: 'initial', type: 'ios' })
    .mockReturnValueOnce(token.promise);
  await renderHook(() =>
    usePushDeviceRegistration(firstUser.id, 'first.session', 'arrived'),
  );
  await waitFor(() => expect(posted()).toHaveLength(1));
  await foreground();
  await waitFor(() => expect(getToken).toHaveBeenCalledTimes(2));

  readPermission.mockResolvedValue(denied);
  await foreground();
  await waitFor(() => expect(posted()[1]?.body.active).toBe(false));
  await act(() => token.resolve({ data: 'old-token', type: 'ios' }));
  expect(posted()).toHaveLength(2);
});

it('retries a transient failure but uses the rotation event payload and stops a stale retry on permission changes', async () => {
  jest.useFakeTimers();
  request.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await renderHook(() =>
    usePushDeviceRegistration(firstUser.id, 'first.session', 'arrived'),
  );
  await waitFor(() => expect(posted()).toHaveLength(1));
  expect(requestPermission).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTimeAsync(2_000));
  expect(posted()).toHaveLength(2);
  expect(posted()[1]?.body).toMatchObject({ active: true, revision: 2 });

  request.mockRejectedValueOnce(new Error('offline'));
  await act(() => {
    for (const listener of allTokenListeners) {
      listener({ data: 'ignored-platform', type: 'android' });
      listener({ data: 'rotated-token', type: 'ios' });
      listener({ data: 'rotated-token', type: 'ios' });
    }
  });
  await waitFor(() =>
    expect(posted()[2]?.body).toMatchObject({ token: 'rotated-token' }),
  );
  expect(getToken).toHaveBeenCalledTimes(2);

  readPermission.mockResolvedValue(denied);
  await foreground();
  await waitFor(() => expect(posted()[3]?.body.active).toBe(false));
  await act(() => jest.advanceTimersByTimeAsync(10_000));
  expect(posted()).toHaveLength(4);
});

it('cleans up with the new session while it is onboarding, then registers only that User at arrival', async () => {
  const stale = deferred<Response>();
  request.mockReturnValueOnce(stale.promise);
  const view = await renderHook<
    void,
    {
      id: string;
      session: string;
      arrival: PushContext['arrival'];
    }
  >(
    ({ id, session, arrival }) =>
      usePushDeviceRegistration(id, session, arrival),
    {
      initialProps: {
        id: firstUser.id,
        session: 'first.session',
        arrival: 'arrived',
      },
    },
  );
  await waitFor(() => expect(posted()).toHaveLength(1));
  await view.rerender({
    id: 'user-2',
    session: 'second.session',
    arrival: 'onboarding',
  });
  await waitFor(() => expect(posted()[1]?.body.active).toBe(false));
  expect(posted()[0]?.signal?.aborted).toBe(true);
  expect(posted()[1]).toMatchObject({
    authorization: 'Bearer second.session',
    body: {
      installationId: posted()[0]?.body.installationId,
      revision: 2,
    },
  });
  await view.rerender({
    id: 'user-2',
    session: 'second.session',
    arrival: 'travelling',
  });
  await act(() => stale.resolve(noContent()));
  expect(posted()).toHaveLength(2);
  await view.rerender({
    id: 'user-2',
    session: 'second.session',
    arrival: 'arrived',
  });
  await waitFor(() =>
    expect(posted()[2]?.body).toMatchObject({ active: true, revision: 3 }),
  );
  expect(posted()[2]?.authorization).toBe('Bearer second.session');
});

it('selects the APNs entitlement and Android FCM configuration for the build variant', () => {
  const config = createAppConfig(
    {},
    {
      APP_VARIANT: 'production',
      EXPO_PUBLIC_API_URL: 'https://api.example.com',
      GOOGLE_SERVICES_JSON: '/example/android/google-services.json',
    },
  );
  expect(config.plugins).toContainEqual([
    'expo-notifications',
    { mode: 'production' },
  ]);
  expect(config.android?.googleServicesFile).toBe(
    '/example/android/google-services.json',
  );

  const preview = createAppConfig(
    {},
    {
      APP_VARIANT: 'preview',
      EXPO_PUBLIC_API_URL: 'https://preview-api.example.com',
    },
  );
  expect(preview.plugins).toContainEqual([
    'expo-notifications',
    { mode: 'development' },
  ]);
  expect(preview.android?.googleServicesFile).toBeUndefined();
});

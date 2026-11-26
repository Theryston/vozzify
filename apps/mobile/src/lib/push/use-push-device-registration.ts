import { onlineManager } from '@tanstack/react-query';
import { pushPlatformSchema } from '@vozzify/contracts';
import { addPushTokenListener } from 'expo-notifications';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { MobileApiError, MobileHttpError } from '../api/mobile-api-error';
import { type PushContext, reconcilePushDevice } from './reconcile-push-device';

type Target = Omit<PushContext, 'signal' | 'rotatedToken'>;

const firstRetryMs = 2_000;
const maxRetryMs = 60_000;

function shouldRetry(error: unknown) {
  if (error instanceof MobileHttpError) {
    return (
      error.statusCode === 409 ||
      error.statusCode === 429 ||
      error.statusCode >= 500
    );
  }
  return !(error instanceof MobileApiError && error.kind === 'invalid-request');
}

function createSynchronizer(target: Target) {
  let controller: AbortController | undefined;
  let retryDelay = firstRetryMs;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function stop() {
    clearTimeout(retry);
    controller?.abort();
  }

  function run(rotatedToken?: string) {
    stop();
    if (AppState.currentState !== 'active') return;
    controller = new AbortController();
    const { signal } = controller;
    void reconcilePushDevice({ ...target, signal, rotatedToken }).then(
      () => {
        if (!signal.aborted) retryDelay = firstRetryMs;
      },
      (error: unknown) => {
        if (!signal.aborted && shouldRetry(error)) {
          retry = setTimeout(() => run(rotatedToken), retryDelay);
          retryDelay = Math.min(retryDelay * 2, maxRetryMs);
        }
      },
    );
  }

  return { run, stop };
}

function subscribeToPushChanges(target: Target) {
  const sync = createSynchronizer(target);
  let rotatedToken: string | undefined;
  let ready = false;
  function run() {
    if (ready) sync.run(rotatedToken);
  }
  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    rotatedToken = undefined;
    run();
  });
  const network = onlineManager.subscribe((online) => {
    if (online) run();
  });
  const token = addPushTokenListener((nativeToken) => {
    const value: unknown = nativeToken.data;
    if (
      nativeToken.type !== target.platform ||
      typeof value !== 'string' ||
      !value ||
      value === rotatedToken
    )
      return;
    rotatedToken = value;
    run();
  });
  // Wait for the destination to commit before opening the system dialog.
  const frame = requestAnimationFrame(() => {
    ready = true;
    run();
  });
  return () => {
    cancelAnimationFrame(frame);
    sync.stop();
    appState.remove();
    if (typeof token?.remove === 'function') token.remove();
    network();
  };
}

export function usePushDeviceRegistration(
  userId: string | undefined,
  sessionToken: string | undefined,
  arrival: Target['arrival'],
) {
  useEffect(() => {
    const platform = pushPlatformSchema.safeParse(Platform.OS);
    if (!userId || !sessionToken || !platform.success) return;

    return subscribeToPushChanges({
      userId,
      sessionToken,
      platform: platform.data,
      arrival,
    });
  }, [userId, sessionToken, arrival]);
}

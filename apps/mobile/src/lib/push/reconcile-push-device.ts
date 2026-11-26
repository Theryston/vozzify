import type { PushPlatform } from '@vozzify/contracts';
import { getDevicePushTokenAsync } from 'expo-notifications';
import { syncPushDevice } from './push-device-api';
import {
  acknowledgeDeactivation,
  readPushInstallation,
  reservePushRevision,
} from './push-installation';
import { ensureAndroidPushChannel, hasPushPermission } from './push-permission';

export type PushArrival = 'onboarding' | 'travelling' | 'arrived';

export type PushContext = {
  userId: string;
  sessionToken: string;
  arrival: PushArrival;
  platform: PushPlatform;
  signal: AbortSignal;
  rotatedToken?: string;
};

async function writeRegistration(context: PushContext, token?: string) {
  const { signal, userId, platform, sessionToken } = context;
  if (signal.aborted) return;
  const identity = await reservePushRevision({ userId, token, signal });
  if (!identity) return;
  const body = { ...identity, platform };
  await syncPushDevice(
    token === undefined
      ? { ...body, active: false }
      : { ...body, active: true, token },
    sessionToken,
    signal,
  );
  if (token === undefined) await acknowledgeDeactivation(identity.revision);
}

async function register(context: PushContext) {
  const { rotatedToken, platform } = context;
  if (context.signal.aborted) return;
  if (rotatedToken === undefined) await ensureAndroidPushChannel();
  if (context.signal.aborted) return;
  const nativeToken =
    rotatedToken === undefined
      ? await getDevicePushTokenAsync()
      : { type: platform, data: rotatedToken };
  const data: unknown = nativeToken.data;
  if (nativeToken.type === platform && typeof data === 'string' && data) {
    await writeRegistration(context, data);
  }
}

export async function reconcilePushDevice(context: PushContext) {
  const { arrival, userId, signal } = context;
  const installation = await readPushInstallation();
  if (signal.aborted) return;

  const ownerId = installation?.ownerId;
  const mustUnlink =
    ownerId !== undefined && (arrival === 'onboarding' || ownerId !== userId);
  if (mustUnlink) await writeRegistration(context);
  if (signal.aborted || arrival !== 'arrived') return;

  const allowed = await hasPushPermission({
    asked: installation?.permissionSeen ?? false,
    signal,
  });
  if (signal.aborted) return;
  if (!allowed) {
    if (ownerId === userId && !mustUnlink) await writeRegistration(context);
    return;
  }
  await register(context);
}

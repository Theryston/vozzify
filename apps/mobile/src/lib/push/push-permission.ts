import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  holdPermissionRequest,
  type PushPermissionState,
  setPushPermissionState,
} from './push-installation';

type Permission = Notifications.NotificationPermissionsStatus;
type PermissionAttempt = { state: PushPermissionState; signal: AbortSignal };

let prompt: Promise<Permission | undefined> | undefined;

function isGranted(permission: Permission) {
  const ios = permission.ios?.status;
  return (
    permission.status === 'granted' ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function canRequest(permission: Permission, state: PushPermissionState) {
  if (state === 'decided' || !permission.canAskAgain) return false;
  if (permission.status === 'undetermined') return true;
  // Expo can report a fresh Android 13+ install as denied. Once a prompt
  // started, an ambiguous denial may be real even if the process died.
  return (
    state === 'new' &&
    Platform.OS === 'android' &&
    Number(Platform.Version) >= 33
  );
}

export async function ensureAndroidPushChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('vozzify', {
      name: 'Vozzify',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

async function recoverFailedDialog(error: unknown) {
  const permission = await Notifications.getPermissionsAsync().catch(
    () => undefined,
  );
  if (permission && (isGranted(permission) || !canRequest(permission, 'new'))) {
    await setPushPermissionState('decided');
    return permission;
  }
  // A native error can happen before the OS presents the dialog. The next
  // attempt checks the OS again before requesting permission.
  await setPushPermissionState('new');
  throw error;
}

async function openSystemDialog() {
  let permission: Permission;
  try {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  } catch (error) {
    return recoverFailedDialog(error);
  }
  if (isGranted(permission) || permission.status !== 'undetermined') {
    await setPushPermissionState('decided');
  }
  return permission;
}

function requestPermissions(signal: AbortSignal) {
  prompt ??= (async () => {
    await ensureAndroidPushChannel();
    return holdPermissionRequest(signal, openSystemDialog);
  })().finally(() => {
    prompt = undefined;
  });
  return prompt;
}

export async function hasPushPermission({ state, signal }: PermissionAttempt) {
  let permission = await Notifications.getPermissionsAsync();
  if (signal.aborted) return false;
  if (prompt && !isGranted(permission)) {
    const result = await prompt;
    if (result) return isGranted(result);
    permission = await Notifications.getPermissionsAsync();
  }
  const allowed = isGranted(permission);
  if (allowed || (state === 'pending' && !canRequest(permission, state))) {
    await setPushPermissionState('decided', signal);
    return allowed;
  }
  if (!canRequest(permission, state) || signal.aborted) return false;
  const result = await requestPermissions(signal);
  return result !== undefined && isGranted(result);
}

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  recordPermissionDecision,
  releaseFailedPermissionRequest,
} from './push-installation';

type Permission = Notifications.NotificationPermissionsStatus;
type PermissionAttempt = { asked: boolean; signal: AbortSignal };

let prompt: Promise<Permission | undefined> | undefined;

function isGranted(permission: Permission) {
  const ios = permission.ios?.status;
  return (
    permission.status === 'granted' ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function canRequest(permission: Permission, asked: boolean) {
  if (asked || !permission.canAskAgain) return false;
  if (permission.status === 'undetermined') return true;
  // Expo also reports a fresh Android 13+ install as denied when the OS
  // default is disabled. Remember our one request across app restarts.
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}

export async function ensureAndroidPushChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('vozzify', {
      name: 'Vozzify',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

async function openSystemDialog() {
  try {
    return await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  } catch (error) {
    const current = await Notifications.getPermissionsAsync().catch(
      () => undefined,
    );
    if (current && (isGranted(current) || !canRequest(current, false)))
      return current;
    // A rejected native call may never have displayed the dialog. Recheck
    // the OS before retrying; a successful refusal keeps the durable marker.
    await releaseFailedPermissionRequest();
    throw error;
  }
}

function requestPermissions(signal: AbortSignal) {
  prompt ??= (async () => {
    await ensureAndroidPushChannel();
    return recordPermissionDecision(signal, openSystemDialog);
  })().finally(() => {
    prompt = undefined;
  });
  return prompt;
}

export async function hasPushPermission({ asked, signal }: PermissionAttempt) {
  let permission = await Notifications.getPermissionsAsync();
  if (signal.aborted) return false;
  if (prompt && !isGranted(permission)) {
    const result = await prompt;
    permission = result ?? (await Notifications.getPermissionsAsync());
  }
  if (isGranted(permission)) {
    if (!asked) await recordPermissionDecision(signal);
    return true;
  }
  if (!canRequest(permission, asked) || signal.aborted) return false;
  const result = await requestPermissions(signal);
  return result !== undefined && isGranted(result);
}

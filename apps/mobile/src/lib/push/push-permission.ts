import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { recordPermissionDecision } from './push-installation';

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

function requestPermissions(signal: AbortSignal) {
  prompt ??= (async () => {
    await ensureAndroidPushChannel();
    return recordPermissionDecision(signal, () =>
      Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      }),
    );
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

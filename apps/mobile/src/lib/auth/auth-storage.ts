import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { authContinuationSchema } from './auth-continuation';

const verificationSchema = z.object({
  email: z.email().nullable(),
  sentAt: z.number(),
});

const storedAuthSchema = z.object({
  token: z.string().optional(),
  verification: verificationSchema.optional(),
  continuation: authContinuationSchema.optional(),
});

export type StoredAuth = z.infer<typeof storedAuthSchema>;

const storageKey = 'vozzify.auth';

export async function readAuth(): Promise<StoredAuth> {
  const raw = await SecureStore.getItemAsync(storageKey);
  if (!raw) return {};
  try {
    return storedAuthSchema.parse(JSON.parse(raw));
  } catch {
    await SecureStore.deleteItemAsync(storageKey);
    return {};
  }
}

export function writeAuth(record: StoredAuth) {
  return SecureStore.setItemAsync(storageKey, JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

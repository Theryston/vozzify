import {
  type PushInstallationIdentity,
  pushInstallationIdentitySchema,
} from '@vozzify/contracts';
import { getRandomBytesAsync, randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

const installKey = 'vozzify.push-installation';
const recordSchema = pushInstallationIdentitySchema.extend({
  revision: z.int().nonnegative(),
  permission: z.enum(['new', 'pending', 'decided']),
  ownerId: z.string().optional(),
});

type Installation = z.infer<typeof recordSchema>;
export type PushPermissionState = Installation['permission'];
type PushChange = { userId: string; token?: string; signal: AbortSignal };

let storageQueue: Promise<unknown> = Promise.resolve();

async function read() {
  const raw = await SecureStore.getItemAsync(installKey);
  return raw ? recordSchema.parse(JSON.parse(raw)) : undefined;
}

async function create(): Promise<Installation> {
  const bytes = await getRandomBytesAsync(32);
  return {
    installationId: randomUUID(),
    installationSecret: Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
    revision: 0,
    permission: 'new',
  };
}

function save(record: Installation) {
  return SecureStore.setItemAsync(installKey, JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

function edit<T>(change: (record: Installation | undefined) => Promise<T>) {
  // Persist before sending. Even if a request outlives cancellation or the
  // app is restarted, the next intention has a higher revision.
  const result = storageQueue.then(async () => change(await read()));
  storageQueue = result.catch(() => undefined);
  return result;
}

export function readPushInstallation() {
  return edit(async (record) => record);
}

export function setPushPermissionState(
  state: PushPermissionState,
  signal?: AbortSignal,
) {
  return edit(async (record) => {
    if (record?.permission === state || signal?.aborted) return;
    const installation = record ?? (await create());
    if (!signal?.aborted) await save({ ...installation, permission: state });
  });
}

export async function holdPermissionRequest<T>(
  signal: AbortSignal,
  request: () => Promise<T>,
) {
  const decision = await edit(async (record) => {
    if (signal.aborted || record?.permission === 'decided') return;
    const installation = record ?? (await create());
    if (signal.aborted) return;
    await save({ ...installation, permission: 'pending' });
    if (signal.aborted) {
      await save(installation);
      return;
    }
    // Let installation writes continue while the system dialog is open.
    return { permission: request() };
  });
  return decision?.permission;
}

export function reservePushRevision({ userId, token, signal }: PushChange) {
  return edit(async (record) => {
    if (signal.aborted) return undefined;
    const installation = record ?? (await create());
    if (signal.aborted) return undefined;
    const next = {
      ...installation,
      revision: installation.revision + 1,
      // Even an activation with a lost response might have reached the API.
      ownerId: token === undefined ? installation.ownerId : userId,
    };
    await save(next);
    if (signal.aborted) return undefined;
    const { installationId, installationSecret, revision } = next;
    return {
      installationId,
      installationSecret,
      revision,
    } satisfies PushInstallationIdentity & { revision: number };
  });
}

export function acknowledgeDeactivation(revision: number) {
  return edit(async (record) => {
    if (record?.revision === revision && record.ownerId !== undefined) {
      await save({ ...record, ownerId: undefined });
    }
  });
}

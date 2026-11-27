import {
  type SyncPushDeviceBody,
  syncPushDeviceBodySchema,
} from '@vozzify/contracts';
import { z } from 'zod';
import { mobileApi } from '../api/mobile-api';

export function syncPushDevice(
  body: SyncPushDeviceBody,
  token: string,
  signal: AbortSignal,
) {
  return mobileApi('/me/push-devices', {
    method: 'PUT',
    schema: z.undefined(),
    bodySchema: syncPushDeviceBodySchema,
    body,
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
}

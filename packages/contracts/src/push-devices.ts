import { z } from 'zod';

export const pushInstallationIdentitySchema = z.object({
  installationId: z.uuidv4(),
  installationSecret: z.string().regex(/^[a-f0-9]{64}$/),
});

export const pushPlatformSchema = z.enum(['android', 'ios']);

const pushInstallation = {
  ...pushInstallationIdentitySchema.shape,
  platform: pushPlatformSchema,
  revision: z.int().positive(),
};

export const syncPushDeviceBodySchema = z.discriminatedUnion('active', [
  z.strictObject({
    ...pushInstallation,
    active: z.literal(true),
    token: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[!-~]+$/),
  }),
  z.strictObject({
    ...pushInstallation,
    active: z.literal(false),
  }),
]);

export type SyncPushDeviceBody = z.infer<typeof syncPushDeviceBodySchema>;

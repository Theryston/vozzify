import { z } from 'zod';

export const pushInstallationIdentitySchema = z.object({
  installationId: z.uuidv4(),
  installationSecret: z.string().regex(/^[a-f0-9]{64}$/),
});

export type PushInstallationIdentity = z.infer<
  typeof pushInstallationIdentitySchema
>;

export const PUSH_PLATFORMS = ['android', 'ios'] as const;
export const pushPlatformSchema = z.enum(PUSH_PLATFORMS);

export type PushPlatform = z.infer<typeof pushPlatformSchema>;

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

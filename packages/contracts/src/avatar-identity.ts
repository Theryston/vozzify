import { z } from 'zod';

/** Public presentation marks for the User whose Avatar is displayed. */
export const avatarIdentitySchema = z.object({
  pro: z.boolean().optional(),
  admin: z.boolean().optional(),
});

export type AvatarIdentity = z.infer<typeof avatarIdentitySchema>;

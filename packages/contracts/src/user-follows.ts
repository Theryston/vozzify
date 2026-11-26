import { z } from 'zod';
import { avatarIdentitySchema } from './avatar-identity.js';

import { cursorPageSchema } from './pagination.js';

/**
 * Route param of `PUT` and `DELETE /v1/me/following/:userId`: the User the
 * signed-in User follows or stops following, by User ID.
 */
export const followedUserParamSchema = z.object({
  userId: z.string().min(1).max(128),
});

export type FollowedUserParam = z.infer<typeof followedUserParamSchema>;

/**
 * `GET /v1/users/:username/follow`: what the signed-in viewer has with the
 * Profile's User. `userId` is the ID the follow writes take; it is only sent
 * to a signed-in viewer, never on the public banner.
 */
export const profileFollowSchema = z.object({
  userId: z.string().min(1),
  isFollowing: z.boolean(),
});

export type ProfileFollow = z.infer<typeof profileFollowSchema>;

/**
 * One User in a follow list (followers, following or friends): the public
 * summary a row shows. `username` is `null` for a User who has not picked one
 * yet; such a row has no Profile to link to.
 */
export const followListUserSchema = z.object({
  id: z.string().min(1).max(128),
  username: z.string().min(1).max(100).nullable(),
  name: z.string().min(1).max(200),
  image: z.string().min(1).max(2000).nullable(),
  avatarIdentity: avatarIdentitySchema.optional(),
});

export type FollowListUser = z.infer<typeof followListUserSchema>;

/**
 * One cursor page of a Profile's follow list: `GET /v1/users/:username/followers`,
 * `.../following` or `.../friends`. Newest follow first; query params are
 * `cursorPaginationQuerySchema`.
 */
export const followListPageSchema = cursorPageSchema(followListUserSchema);

export type FollowListPage = z.infer<typeof followListPageSchema>;

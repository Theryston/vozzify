import { z } from 'zod';
import { avatarIdentitySchema } from './avatar-identity.js';

import { trackVocalRangeSchema } from './tracks.js';
import { dailyPracticeTargetSecondsSchema } from './users.js';

/**
 * Route param for `GET /v1/users/:username`. Any case is accepted: the lookup
 * is case-insensitive, and the web redirects mixed-case paths to lowercase.
 * Not validated against the username rules, so an impossible name is a plain
 * 404 instead of a 400 the web would show as an error.
 */
export const publicProfileParamSchema = z.object({
  username: z.string().min(1).max(128),
});

export type PublicProfileParam = z.infer<typeof publicProfileParamSchema>;

/**
 * The Artist a User sings most (the chip of the banner): its public ID, the
 * one its page is addressed by, and its display name.
 */
export const mostSungArtistSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1),
});

export type MostSungArtist = z.infer<typeof mostSungArtistSchema>;

/**
 * The public banner of a Profile (`GET /v1/users/:username`): only what any
 * visitor may see. Sections are added by later slices and are never sent to
 * visitors when hidden by their owner.
 *
 * The three chips are always present and `null` when they have nothing to
 * show: no Daily target set, no qualifying Attempt for the Vocal range, no
 * valid Attempt for the Most sung artist.
 */
export const publicProfileSchema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  image: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  dailyPracticeTargetSeconds: dailyPracticeTargetSecondsSchema.nullable(),
  /** The lowest and highest notes the User sings, as MIDI numbers. */
  vocalRange: trackVocalRangeSchema.nullable(),
  mostSungArtist: mostSungArtistSchema.nullable(),
  /** Users who follow this User. */
  followersCount: z.number().int().nonnegative(),
  /** Users this User follows. */
  followingCount: z.number().int().nonnegative(),
  /** Mutual follows: Users this User follows who follow them back. */
  friendsCount: z.number().int().nonnegative(),
  avatarIdentity: avatarIdentitySchema.optional(),
});

export type PublicProfile = z.infer<typeof publicProfileSchema>;

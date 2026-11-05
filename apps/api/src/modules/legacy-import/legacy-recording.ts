import { z } from 'zod';

/** The frozen legacy Track fields used to resolve a Music catalog Recording. */
export const legacyTrackSchema = z.object({
  id: z.string().min(1),
  ytId: z.string().nullable(),
  title: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  duration: z.string().nullable(),
  albumId: z.string().nullable(),
  albumName: z.string().nullable(),
  albumYtId: z.string().nullable(),
  creatorId: z.string().min(1),
  createdAt: z.date(),
  dependentFavorites: z.number().int().nonnegative(),
  dependentViews: z.number().int().nonnegative(),
  artists: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      ytId: z.string(),
    }),
  ),
});

export type LegacyTrack = z.infer<typeof legacyTrackSchema>;

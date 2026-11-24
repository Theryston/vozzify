import { z } from 'zod';

export const PRIVATE_TRACK_ASSET_CLEANUP_QUEUE = 'private-track-asset-cleanup';
export const CLEAN_PRIVATE_TRACK_PREFIX = 'clean-private-track-prefix';
export const CLEAN_PRIVATE_TRACK_OBJECT = 'clean-private-track-object';
export const PRIVATE_TRACK_UPLOAD_URL_TTL_MS = 2 * 60 * 60 * 1000;

export const cleanPrivateTrackPrefixJobSchema = z.object({
  userId: z.string(),
  privateTrackId: z.string(),
  prefix: z.string(),
  sourceKey: z.string(),
});
export type CleanPrivateTrackPrefixJob = z.infer<
  typeof cleanPrivateTrackPrefixJobSchema
>;

export const cleanPrivateTrackObjectJobSchema = z.object({
  key: z.string(),
});
export type CleanPrivateTrackObjectJob = z.infer<
  typeof cleanPrivateTrackObjectJobSchema
>;

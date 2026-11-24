import { z } from 'zod';

export const PRIVATE_TRACK_PROCESSING_QUEUE = 'private-track-processing';
export const PROCESS_PRIVATE_TRACK_JOB = 'process-private-track';
export const CLEAN_PRIVATE_TRACK_ASSETS_JOB = 'clean-private-track-assets';

export const processPrivateTrackJobSchema = z.object({
  privateTrackId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  poll: z.number().int().min(0).default(0),
});

export type ProcessPrivateTrackJob = z.infer<
  typeof processPrivateTrackJobSchema
>;

export const cleanPrivateTrackAssetsJobSchema = z.object({
  keys: z.array(z.string().min(1)),
});

export type CleanPrivateTrackAssetsJob = z.infer<
  typeof cleanPrivateTrackAssetsJobSchema
>;

export const privateTrackPollingJobId = (
  privateTrackId: string,
  poll: number,
) => `private-track-${privateTrackId}-poll-${poll}`;

import { z } from 'zod';

export const PRIVATE_TRACK_PROCESSING_QUEUE = 'private-track-processing';
export const PROCESS_PRIVATE_TRACK_JOB = 'process-private-track';
export const CLEAN_PRIVATE_TRACK_ASSETS_JOB = 'clean-private-track-assets';
export const RECONCILE_PRIVATE_TRACKS_JOB = 'reconcile-private-tracks';
export const PRIVATE_TRACK_RECONCILIATION_SCHEDULER =
  'private-track-reconciliation';

export type ReconcilePrivateTracksJob = Record<string, never>;

export const processPrivateTrackJobSchema = z.object({
  privateTrackId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  poll: z.number().int().min(0).default(0),
  attemptId: z.string().min(1).optional(),
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
  attemptId: string,
  poll: number,
) => `private-track-${privateTrackId}-${attemptId}-poll-${poll}`;

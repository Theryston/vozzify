import { z } from 'zod';

export const PRIVATE_TRACK_IDENTIFICATION_QUEUE =
  'private-track-identification';
export const IDENTIFY_PRIVATE_TRACK_JOB = 'identify-private-track';

export const identifyPrivateTrackJobSchema = z.object({
  privateTrackId: z.string().min(1).max(128),
});
export type IdentifyPrivateTrackJob = z.infer<
  typeof identifyPrivateTrackJobSchema
>;

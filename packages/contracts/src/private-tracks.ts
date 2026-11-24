import { z } from 'zod';

export const PRIVATE_AUDIO_MAX_BYTES = 250 * 1024 * 1024;
export const PRIVATE_AUDIO_MAX_DURATION_SECONDS = 30 * 60;

export const privateTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  durationMs: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type PrivateTrack = z.infer<typeof privateTrackSchema>;

export const createPrivateTrackBodySchema = z.strictObject({
  audio: z.file().max(PRIVATE_AUDIO_MAX_BYTES),
});
export type CreatePrivateTrackBody = z.infer<
  typeof createPrivateTrackBodySchema
>;

export const myPrivateTracksSchema = z.object({
  canSubmit: z.boolean(),
  tracks: z.array(privateTrackSchema),
});
export type MyPrivateTracks = z.infer<typeof myPrivateTracksSchema>;

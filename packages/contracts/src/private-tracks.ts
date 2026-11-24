import { z } from 'zod';
import { cursorPageSchema, cursorPaginationQuerySchema } from './pagination.js';

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

export const myPrivateTracksQuerySchema = cursorPaginationQuerySchema;
export type MyPrivateTracksQuery = z.infer<typeof myPrivateTracksQuerySchema>;

export const myPrivateTracksPageSchema = cursorPageSchema(
  privateTrackSchema,
).extend({ canSubmit: z.boolean() });
export type MyPrivateTracksPage = z.infer<typeof myPrivateTracksPageSchema>;

export const createPrivateTrackBodySchema = z.strictObject({
  audio: z.file().min(1).max(PRIVATE_AUDIO_MAX_BYTES),
});
export type CreatePrivateTrackBody = z.infer<
  typeof createPrivateTrackBodySchema
>;

export const privateAudioSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(PRIVATE_AUDIO_MAX_BYTES);

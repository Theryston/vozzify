import { z } from 'zod';
import { cursorPageSchema, cursorPaginationQuerySchema } from './pagination.js';

export const PRIVATE_AUDIO_MAX_BYTES = 250 * 1024 * 1024;
export const PRIVATE_AUDIO_MAX_DURATION_SECONDS = 30 * 60;

export const PRIVATE_TRACK_PROCESSING_STATES = [
  'QUEUED',
  'EXTRACTING_VOCALS',
  'DETECTING_NOTES',
  'COMPLETED',
  'FAILED',
] as const;

export const privateTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  durationMs: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  processing: z
    .object({
      status: z.enum(PRIVATE_TRACK_PROCESSING_STATES),
      progress: z.number().int().min(0).max(100),
    })
    .optional(),
});
export type PrivateTrack = z.infer<typeof privateTrackSchema>;

export const privateTrackProcessingStateSchema = z.object({
  status: z.enum(PRIVATE_TRACK_PROCESSING_STATES),
  progress: z.number().int().min(0).max(100),
});
export type PrivateTrackProcessingState = z.infer<
  typeof privateTrackProcessingStateSchema
>;

export const privateTrackDetailSchema = privateTrackSchema.extend({
  ownerId: z.string().min(1),
  processing: privateTrackProcessingStateSchema,
  locked: z.boolean(),
  notes: z.array(
    z.object({
      pitch: z.number(),
      start: z.number().min(0),
      end: z.number().positive(),
    }),
  ),
});
export type PrivateTrackDetail = z.infer<typeof privateTrackDetailSchema>;

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

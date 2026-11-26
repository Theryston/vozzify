import { z } from 'zod';
import { mbidSchema } from './music-catalog.js';
import { cursorPageSchema, cursorPaginationQuerySchema } from './pagination.js';
import { trackAudioSchema } from './track-audio.js';
import { trackKeySchema, trackLyricsSchema } from './tracks.js';

export const PRIVATE_AUDIO_MAX_BYTES = 250 * 1024 * 1024;
export const PRIVATE_AUDIO_MAX_DURATION_SECONDS = 30 * 60;
export const PRIVATE_YOUTUBE_URL_MAX_LENGTH = 2048;
export const PRIVATE_TRACK_METADATA_MAX_LENGTH = 512;
export const MISSING_PRIVATE_VIDEO_AUDIO = 'MISSING_VIDEO_AUDIO';

export const privateTrackUploadErrorDetailsSchema = z.object({
  location: z.literal('body'),
  issues: z
    .array(
      z.object({
        params: z.object({ reason: z.literal(MISSING_PRIVATE_VIDEO_AUDIO) }),
      }),
    )
    .min(1),
});

export const PRIVATE_TRACK_PROCESSING_STATES = [
  'QUEUED',
  'EXTRACTING_VOCALS',
  'DETECTING_NOTES',
  'EXTRACTING_LYRICS',
  'COMPLETED',
  'FAILED',
] as const;

export const privateTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  coverUrl: z.string().optional(),
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

const privateTrackRecordingSchema = z.object({
  mbid: mbidSchema,
  title: z.string(),
  artist: z.string(),
  coverUrl: z.string().nullable(),
});
export type PrivateTrackRecording = z.infer<typeof privateTrackRecordingSchema>;

export const updatePrivateTrackMetadataBodySchema = z
  .strictObject({
    title: z
      .string()
      .trim()
      .min(1)
      .max(PRIVATE_TRACK_METADATA_MAX_LENGTH)
      .optional(),
    artist: z.string().trim().max(PRIVATE_TRACK_METADATA_MAX_LENGTH).optional(),
    recordingMbid: mbidSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide a metadata change');
export type UpdatePrivateTrackMetadataBody = z.infer<
  typeof updatePrivateTrackMetadataBodySchema
>;

export const privateTrackDetailSchema = privateTrackSchema.extend({
  ownerId: z.string().min(1),
  processing: privateTrackProcessingStateSchema,
  locked: z.boolean(),
  youtubeVideoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .optional(),
  recording: privateTrackRecordingSchema.optional(),
  audio: trackAudioSchema.optional(),
  lyrics: trackLyricsSchema.optional(),
  key: trackKeySchema.optional(),
  notes: z.array(
    z.object({
      pitch: z.number(),
      start: z.number().min(0),
      end: z.number().positive(),
    }),
  ),
});
export type PrivateTrackDetail = z.infer<typeof privateTrackDetailSchema>;

export const privateTrackIdParamsSchema = z.object({
  id: z.string().min(1).max(128),
});
export type PrivateTrackIdParams = z.infer<typeof privateTrackIdParamsSchema>;

export const privateTrackMediaParamsSchema = privateTrackIdParamsSchema.extend({
  kind: z.enum(['music', 'vocals']),
});
export type PrivateTrackMediaParams = z.infer<
  typeof privateTrackMediaParamsSchema
>;

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

export const createPrivateYouTubeTrackBodySchema = z.strictObject({
  url: z.string().trim().max(PRIVATE_YOUTUBE_URL_MAX_LENGTH).url(),
});
export type CreatePrivateYouTubeTrackBody = z.infer<
  typeof createPrivateYouTubeTrackBodySchema
>;

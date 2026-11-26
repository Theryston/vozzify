import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';
import { users } from './users.js';

/** User-owned audio sources stay outside the public catalog. */
export const privateTracks = pgTable(
  'private_tracks',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentSha256: text(),
    youtubeVideoId: text(),
    objectKey: text().notNull(),
    originalFilename: text().notNull(),
    title: text().notNull(),
    artist: text().notNull().default(''),
    durationMs: integer().notNull(),
    processingStatus: text().notNull().default('QUEUED'),
    processingProgress: integer().notNull().default(0),
    processingJobId: text(),
    processingAttemptId: text(),
    processingRetryId: text(),
    detectorVersion: text(),
    mediaObjectKey: text(),
    vocalsObjectKey: text(),
    pitchCurveObjectKey: text(),
    ...timestamps,
    createdAt: timestamp({ withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('private_tracks_object_key_unique').on(table.objectKey),
    unique('private_tracks_user_id_content_sha256_unique').on(
      table.userId,
      table.contentSha256,
    ),
    unique('private_tracks_user_id_youtube_video_id_unique').on(
      table.userId,
      table.youtubeVideoId,
    ),
    index().on(table.userId, table.createdAt, table.id),
    index('private_tracks_processing_queue_idx').on(
      table.processingStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const privateTrackNotes = pgTable(
  'private_track_notes',
  {
    id: id(),
    privateTrackId: text()
      .notNull()
      .references(() => privateTracks.id, { onDelete: 'cascade' }),
    pitch: doublePrecision().notNull(),
    start: doublePrecision().notNull(),
    end: doublePrecision().notNull(),
    ...timestamps,
  },
  (table) => [index().on(table.privateTrackId, table.start)],
);

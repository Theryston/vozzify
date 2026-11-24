import { index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
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
    contentSha256: text().notNull(),
    objectKey: text().notNull(),
    originalFilename: text().notNull(),
    title: text().notNull(),
    artist: text().notNull().default(''),
    durationMs: integer().notNull(),
    ...timestamps,
  },
  (table) => [
    unique('private_tracks_object_key_unique').on(table.objectKey),
    unique('private_tracks_user_id_content_sha256_unique').on(
      table.userId,
      table.contentSha256,
    ),
    index().on(table.userId, table.createdAt, table.id),
  ],
);

import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { practiceAttemptColumns } from './practice-attempts.js';
import { privateTracks } from './private-tracks.js';

/** Separate storage keeps private performances out of public Track analytics. */
export const privatePracticeAttempts = pgTable(
  'private_practice_attempts',
  {
    ...practiceAttemptColumns(),
    // The run still contributes to the total after the owner deletes its Track.
    privateTrackId: text().references(() => privateTracks.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index().on(table.userId, table.createdAt, table.id),
    index().on(table.privateTrackId),
  ],
);

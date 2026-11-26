import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';
import { trackViews } from './track-views.js';
import { tracks } from './tracks.js';
import { users } from './users.js';

/** How strict the pitch matching of an attempt was. */
export const practiceDifficulty = pgEnum('practice_difficulty', [
  'EASY',
  'NORMAL',
  'HARD',
]);

/** Whether the attempt counted other octaves as hits (`ANY`) or not (`EXACT`). */
export const octaveMode = pgEnum('octave_mode', ['ANY', 'EXACT']);

/** Shared by public and owner-only runs so both store the same scoring fields. */
export const practiceAttemptColumns = () => ({
  id: id(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  difficulty: practiceDifficulty().notNull(),
  octaveMode: octaveMode().notNull(),
  transposeSemitones: integer().notNull(),
  speed: real().notNull(),
  /** Hit notes divided by judged notes, from 0 to 1. */
  accuracy: real().notNull(),
  /** Judged notes divided by the Track's notes, from 0 to 1. */
  coverage: real().notNull(),
  forwardSkip: boolean().notNull().default(false),
  /** A steady voiced pitch was detected while the Track had no vocal notes. */
  bleedSuspected: boolean().notNull().default(false),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  endedAt: timestamp({ withTimezone: true }).notNull(),
  ...timestamps,
});

/**
 * A signed-in User's saved practice run on a Track: only runs that covered
 * at least 90% of the notes without skipping forward are saved (the API
 * refuses the rest). Attempts have no legacy equivalent: the legacy app kept
 * no per-run history. `viewId` is null for old or unlinked rows.
 */
export const practiceAttempts = pgTable(
  'practice_attempts',
  {
    ...practiceAttemptColumns(),
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    viewId: text().references(() => trackViews.id, { onDelete: 'set null' }),
  },
  (table) => [
    // The best score per difficulty of a User on a Track.
    index().on(table.userId, table.trackId),
    // The User's own history, newest first.
    index().on(table.userId, table.createdAt),
    // The home's "Most sung" row counts valid runs per Track in a window.
    index().on(table.trackId, table.createdAt),
  ],
);

import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';

/** Durable Sonic projection work, independent from Music catalog associations. */
export const trackSearchIndexEvents = pgTable(
  'track_search_index_events',
  {
    id: id(),
    // Deliberately has no FK: delete projections must survive Track removal.
    trackId: text().notNull().unique(),
    operation: text({ enum: ['upsert', 'delete'] }).notNull(),
    searchableText: text(),
    sourceUpdatedAt: timestamp({ withTimezone: true }).notNull(),
    revision: integer().notNull().default(1),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    claimedUntil: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('track_search_index_events_pending_idx')
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.deliveredAt} is null`),
  ],
);

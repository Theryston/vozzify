import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { timestamps } from '../columns.js';
import { trackProcessings } from './track-processings.js';

/** A durable slot is held from admission until its Processing becomes terminal. */
export const legacyProcessingAdmissions = pgTable(
  'legacy_processing_admissions',
  {
    id: text()
      .primaryKey()
      .references(() => trackProcessings.id, { onDelete: 'cascade' }),
    startedAt: timestamp({ withTimezone: true }),
    admittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [index().on(table.admittedAt)],
);

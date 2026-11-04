import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from '../columns.js';
import { trackProcessings } from './track-processings.js';
import { tracks } from './tracks.js';

/** Attempt-level provenance survives jobs, delays and operator retries. */
export const legacyProcessingOrigins = pgTable(
  'legacy_processing_origins',
  {
    id: text()
      .primaryKey()
      .references(() => trackProcessings.id, { onDelete: 'cascade' }),
    recordingMbid: text().notNull(),
    ...timestamps,
  },
  (table) => [index().on(table.recordingMbid)],
);

/** Acknowledgement is separate from creation so interrupted preparation can recover. */
export const legacyRecordingImports = pgTable('legacy_recording_imports', {
  id: text().primaryKey(),
  sourceDigest: text().notNull(),
  trackId: text()
    .notNull()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  initialProcessingId: text()
    .notNull()
    .references(() => trackProcessings.id, { onDelete: 'cascade' }),
  processingId: text()
    .notNull()
    .references(() => trackProcessings.id, { onDelete: 'cascade' }),
  ...timestamps,
});

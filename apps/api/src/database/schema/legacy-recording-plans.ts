import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../columns.js';

/** A durable correspondence decision for one frozen legacy Track. */
export const legacyRecordingPlans = pgTable(
  'legacy_recording_plans',
  {
    legacyTrackId: text().primaryKey(),
    sourceDigest: text().notNull(),
    sourceCreatedAt: timestamp({ withTimezone: true }).notNull(),
    sourceCreatorId: text().notNull(),
    recordingMbid: text(),
    status: text().notNull(),
    rationale: text().notNull(),
    skipReason: text(),
    source: jsonb().notNull(),
    initialContributor: boolean().notNull().default(false),
    ...timestamps,
  },
  (table) => [index().on(table.recordingMbid), index().on(table.status)],
);

/** Inventory fingerprint and completion marker for the correspondence stage. */
export const legacyRecordingPlanRuns = pgTable('legacy_recording_plan_runs', {
  id: text().primaryKey(),
  sourceDigest: text().notNull(),
  sourceTracks: integer().notNull(),
  status: text().notNull().default('incomplete'),
  ...timestamps,
});

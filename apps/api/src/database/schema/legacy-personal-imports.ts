import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from '../columns.js';

// A row is committed with one User's historical practice and privacy settings.
export const legacyPersonalImports = pgTable('legacy_personal_imports', {
  id: text().primaryKey(),
  sourceDigest: text().notNull(),
  status: text().notNull().default('incomplete'),
  lastPracticeId: text(),
  importedPracticeDays: integer().notNull().default(0),
  ...timestamps,
});

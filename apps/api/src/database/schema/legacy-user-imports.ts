import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from '../columns.js';

// A cursor advances in the same transaction as the User and every identity.
// Replaying a frozen source never writes those credentials a second time.
export const legacyUserImports = pgTable('legacy_user_imports', {
  id: text().primaryKey(),
  sourceDigest: text().notNull(),
  status: text().notNull().default('incomplete'),
  lastUserId: text(),
  importedUsers: integer().notNull().default(0),
  importedAccounts: integer().notNull().default(0),
  ...timestamps,
});

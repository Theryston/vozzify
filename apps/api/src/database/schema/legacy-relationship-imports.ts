import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from '../columns.js';

/** Durable cursor for importing legacy favorites and views. */
export const legacyRelationshipImports = pgTable(
  'legacy_relationship_imports',
  {
    id: text().primaryKey(),
    sourceDigest: text().notNull(),
    status: text().notNull().default('incomplete'),
    lastFavoriteId: text(),
    lastRefreshedFavoriteId: text(),
    lastViewId: text(),
    lastRefreshedViewId: text(),
    importedFavorites: integer().notNull().default(0),
    acceptedFavorites: integer().notNull().default(0),
    deduplicatedFavorites: integer().notNull().default(0),
    importedViews: integer().notNull().default(0),
    skippedFavorites: integer().notNull().default(0),
    skippedViews: integer().notNull().default(0),
    ...timestamps,
  },
);

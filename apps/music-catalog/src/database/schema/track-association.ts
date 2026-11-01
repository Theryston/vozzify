import { boolean, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { musicCatalog } from './music-catalog-schema.js';

/** The latest API-owned Track link and its coalesced index retry state. */
export const trackAssociation = musicCatalog.table('track_association', {
  recordingMbid: uuid().primaryKey(),
  trackId: text(),
  businessScore: integer(),
  revision: integer().notNull().default(0),
  pending: boolean().notNull().default(true),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

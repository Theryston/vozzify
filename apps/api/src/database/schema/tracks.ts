import type { TrackArtistCreditEntry, TrackKeyMode } from '@vozzify/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';

/**
 * A credit entry as stored: the public entry plus the MBID of the artist it
 * names, which links the credit to an Artist page. Rows stored before the MBID
 * was kept have none, so their names are not linked. The MBID is never sent
 * to clients.
 */
export type StoredArtistCreditEntry = TrackArtistCreditEntry & {
  mbid?: string;
};

/**
 * Track catalog row with its core fields: what the artist page grid lists
 * (title, duration, ISRCs, genres) plus the disambiguation and video flag
 * that tell takes apart. The deeper MusicBrainz sections (releases, works,
 * tags, links) live in the companion tables below. Starts empty: every
 * search hit is unlinked until data is processed. One Track per Recording
 * (Recordings are never grouped).
 */
export const tracks = pgTable(
  'tracks',
  {
    id: id(),
    // The MBID of the MusicBrainz Recording, the only identity of a Track's
    // source. Unique, so the API can decide linked versus static per hit.
    recordingMbid: text().notNull(),
    // Display title, as the artist card and Track page show it. No default: the
    // contract requires a non-empty title, so a missing one must fail at
    // insert time, never as a 500 at read time.
    title: text().notNull(),
    // In milliseconds; null when MusicBrainz has none.
    lengthMs: integer(),
    // Tells apart Recordings with the same title and artist; '' when none.
    disambiguation: text().notNull().default(''),
    // Whether the Recording is a video.
    video: boolean().notNull().default(false),
    isrcs: text().array().notNull().default([]),
    // Display genres, most relevant first; empty when unknown.
    genres: text().array().notNull().default([]),
    // The Recording's artist credit in credit order, written when the Track is
    // created so the header shows its artists before any metadata import.
    artistCredit: jsonb()
      .$type<StoredArtistCreditEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // The cover in our own storage, set when a Processing finds one; null
    // until then, so the page shows a placeholder.
    coverUrl: text(),
    // The YouTube video the timeline plays, set when a Processing chooses it.
    youtubeVideoId: text(),
    // How hot the Track is, from its recent views (see `trending-score.ts`);
    // recomputed by a delayed job after views, 0 until then. Not imported
    // from the legacy app: it is derived from the imported views.
    trendingScore: integer().notNull().default(0),
    // Monotonic source ordering for association score publication. Unlike the
    // outbox row, this survives delivered-event retention cleanup.
    associationRevision: integer().notNull().default(1),
    // The vocal range as MIDI numbers (A4 is 69) and the estimated key (a
    // pitch class, 0 is C, and its mode), written when a Processing replaces
    // the Track's notes. All null for a Track without notes.
    vocalRangeLowest: integer(),
    vocalRangeHighest: integer(),
    keyTonic: integer(),
    keyMode: text().$type<TrackKeyMode>(),
    ...timestamps,
  },
  (table) => [
    unique('tracks_recording_mbid_unique').on(table.recordingMbid),
    // The sitemap lists the highest score first.
    index().on(table.trendingScore, table.id),
  ],
);

/**
 * Every release a Track's Recording appears on: what the Track page shows
 * (title, year, cover art URL with fallback). One Recording that is on two
 * tracks of one release appears once per release here (the track position
 * is a Music catalog concern, not a display one). Ordered by title in
 * reads.
 */
export const trackReleases = pgTable(
  'track_releases',
  {
    id: id(),
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    mbid: text().notNull(),
    title: text().notNull(),
    year: integer(),
    coverArtUrl: text(),
    ...timestamps,
  },
  (table) => [index().on(table.trackId)],
);

/**
 * Every work a Track's Recording links to: what the Track page shows.
 * Ordered by title in reads.
 */
export const trackWorks = pgTable(
  'track_works',
  {
    id: id(),
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    mbid: text().notNull(),
    title: text().notNull(),
    ...timestamps,
  },
  (table) => [index().on(table.trackId)],
);

/**
 * Every tag of a Track's Recording: what the Track page shows, most voted
 * first. Genres stay on the core row; tags are the deeper exploration
 * list.
 */
export const trackTags = pgTable(
  'track_tags',
  {
    id: id(),
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    count: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [index().on(table.trackId)],
);

/**
 * Every external URL of a Track's Recording: what the Track page shows
 * (streaming, MusicBrainz). Ordered by link type in reads.
 */
export const trackExternalLinks = pgTable(
  'track_external_links',
  {
    id: id(),
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    linkType: text().notNull(),
    ...timestamps,
  },
  (table) => [index().on(table.trackId)],
);

/**
 * Legacy ID map of the tracks table (see
 * `docs/adr/0001-reprocessed-catalog-with-legacy-id-maps.md`). Several
 * legacy IDs may point to one Track (legacy has duplicates).
 */
export const legacyTrackIds = pgTable(
  'legacy_track_ids',
  {
    legacyId: text().primaryKey(),
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
  },
  (table) => [index().on(table.trackId)],
);

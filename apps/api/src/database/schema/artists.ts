import { index, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';
import { tracks } from './tracks.js';

/**
 * Vozzify catalog Artist: a public entity with its own URL, distinct
 * from a MusicBrainz artist credit. Created when a Recording is reprocessed;
 * reads never call the Music catalog. Genres are display strings, most
 * relevant first, so the header renders without another lookup.
 */
export const artists = pgTable(
  'artists',
  {
    id: id(),
    // The MBID of the MusicBrainz artist, the only identity of an Artist's
    // source. Unique, like a Track's recording reference.
    mbid: text().notNull(),
    name: text().notNull(),
    genres: text().array().notNull().default([]),
    ...timestamps,
  },
  (table) => [unique('artists_mbid_unique').on(table.mbid)],
);

/**
 * Legacy ID map of the artists table (see
 * `docs/adr/0001-reprocessed-catalog-with-legacy-id-maps.md`). Several
 * legacy IDs may point to one Artist (legacy has duplicates).
 */
export const legacyArtistIds = pgTable(
  'legacy_artist_ids',
  {
    legacyId: text().primaryKey(),
    artistId: text()
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
  },
  (table) => [index().on(table.artistId)],
);

/**
 * Which processed Tracks link to which Artist. One Track per Recording, and
 * a Recording can credit several artists, so this is many-to-many. The
 * header counts it for `trackCount`; the artist tracks listing (a later
 * slice) pages it.
 */
export const trackArtists = pgTable(
  'track_artists',
  {
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    artistId: text()
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.trackId, table.artistId] }),
    index().on(table.artistId),
  ],
);

/**
 * The source credit identity a metadata import resolved to each canonical
 * Artist. Track display keeps the source MBID, while this relation preserves
 * the exact merge correspondence for legacy identity reconciliation.
 */
export const trackArtistCreditResolutions = pgTable(
  'track_artist_credit_resolutions',
  {
    id: id(),
    trackId: text()
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    creditMbid: text().notNull(),
    artistId: text()
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('track_artist_credit_resolutions_track_credit_unique').on(
      table.trackId,
      table.creditMbid,
    ),
    index().on(table.artistId),
  ],
);

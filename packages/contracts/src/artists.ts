import { z } from 'zod';

import { mbidSchema } from './music-catalog.js';
import { cursorPageSchema } from './pagination.js';

// The vozzify catalog's Artist: a public entity with its own URL,
// distinct from a MusicBrainz artist credit. Created when a Recording is
// reprocessed, never on reads. The header shows the name, an initials visual
// (no artist images in the catalog), the track count and the genres.

/** Route param for `GET /v1/artists/:id`: a new ID or a legacy ID. */
export const artistIdParamSchema = z.object({
  id: z.string().min(1).max(128),
});

export type ArtistIdParam = z.infer<typeof artistIdParamSchema>;

export const artistSchema = z.object({
  id: z.string().min(1).max(128),
  /** The MusicBrainz artist MBID the Artist was reprocessed from. */
  mbid: mbidSchema,
  /** Display name, as the header shows it. */
  name: z.string().min(1).max(200),
  /** Display genres, most relevant first; empty when unknown. */
  genres: z.array(z.string().min(1).max(100)).max(30),
  /** How many processed Tracks link to this Artist. */
  trackCount: z.number().int().nonnegative(),
});

export type Artist = z.infer<typeof artistSchema>;

/**
 * `details` of a 404 `RESOURCE_MOVED`: the ID the legacy ID points to, so
 * the web (and the future mobile app) can redirect without another lookup.
 */
export const resourceMovedDetailsSchema = z.object({
  id: z.string().min(1).max(128),
});

export type ResourceMovedDetails = z.infer<typeof resourceMovedDetailsSchema>;

/** One Artist credited on a Track, in display order. */
export const catalogTrackArtistSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
});

export type CatalogTrackArtist = z.infer<typeof catalogTrackArtistSchema>;

export const catalogTrackReleaseSchema = z.object({
  mbid: mbidSchema,
  title: z.string().min(1).max(500),
  /** Release year derived from the earliest release event; null when unknown. */
  year: z.number().int().min(1000).max(9999).nullable(),
  /** Cover Art Archive URL built from the release MBID; null when unknown. */
  coverArtUrl: z.string().min(1).max(2000).nullable(),
});

export type CatalogTrackRelease = z.infer<typeof catalogTrackReleaseSchema>;

export const catalogTrackWorkSchema = z.object({
  mbid: mbidSchema,
  title: z.string().min(1).max(500),
});

export type CatalogTrackWork = z.infer<typeof catalogTrackWorkSchema>;

export const catalogTrackTagSchema = z.object({
  name: z.string().min(1).max(100),
  count: z.number().int().nonnegative(),
});

export type CatalogTrackTag = z.infer<typeof catalogTrackTagSchema>;

export const catalogTrackExternalLinkSchema = z.object({
  url: z.string().min(1).max(2000),
  /** MusicBrainz's name for the relationship, e.g. "streaming music". */
  linkType: z.string().min(1).max(100),
});

export type CatalogTrackExternalLink = z.infer<
  typeof catalogTrackExternalLinkSchema
>;

/**
 * The shape every catalog track listing returns for one processed Track: the
 * card shows the title, the performer names and the first-release cover,
 * while the full shape also carries the catalog details the Track page shows
 * (duration, ISRCs, genres, releases, works, tags, links). Stored in the API
 * database when a Recording is reprocessed, so reads never touch the Music
 * catalog. One entry per Recording. The deeper sections are optional for
 * backward compatibility and empty when the catalog has none.
 */
export const catalogTrackSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  /** In milliseconds; null when MusicBrainz has none. */
  lengthMs: z.number().int().nonnegative().nullable(),
  /** Tells apart Recordings with the same title and artist; '' when none. */
  disambiguation: z.string().max(500),
  /** Whether the Recording is a video. */
  video: z.boolean(),
  isrcs: z.array(z.string().min(1).max(32)).max(30),
  /** Every linked Artist, in alphabetical order; never empty. */
  artists: z.array(catalogTrackArtistSchema).min(1).max(30),
  /** Display genres, most relevant first; empty when unknown. */
  genres: z.array(z.string().min(1).max(100)).max(30),
  /** All releases in title order; popular Recordings can have many editions. */
  releases: z.array(catalogTrackReleaseSchema).optional(),
  /** Every linked work, in title order; empty when none. */
  works: z.array(catalogTrackWorkSchema).max(30).optional(),
  /** Every tag, most voted first; empty when none. */
  tags: z.array(catalogTrackTagSchema).max(30).optional(),
  /** Every external URL, in link-type order; empty when none. */
  externalLinks: z.array(catalogTrackExternalLinkSchema).max(30).optional(),
});

export type CatalogTrack = z.infer<typeof catalogTrackSchema>;

/**
 * One cursor page of catalog Tracks, with one entry per processed Recording,
 * in stable `id` order. Cursors are opaque base64url strings, never raw
 * offsets. `GET /v1/artists/:id/tracks` is its current use.
 */
export const catalogTracksPageSchema = cursorPageSchema(catalogTrackSchema);

export type CatalogTracksPage = z.infer<typeof catalogTracksPageSchema>;

import { z } from 'zod';
import { localeSchema } from './locales.js';
import {
  trackArtistCreditEntrySchema,
  trackHeaderSchema,
  trackVocalRangeSchema,
} from './tracks.js';

/**
 * The home feed (`GET /v1/home`): an ordered list of rows. Clients render the
 * layouts they know and ignore the others (a row whose `layout` fails the
 * discriminated union is skipped), so a newer API never breaks an older app.
 */

/**
 * Who the feed was built for. The public feed is shared by every visitor;
 * the personal feed blends it with the signed-in User's own signals.
 */
export const homeAudienceSchema = z.enum(['public', 'personal']);

export type HomeAudience = z.infer<typeof homeAudienceSchema>;

/**
 * One credited artist of a home card. `artistId` is the Artist page the name
 * links to, null while the credit has no Artist in our catalog. It is
 * `nullish` because the web may deploy before the API that sends it, so a
 * card without the field still parses; the API always sends it.
 */
export const homeArtistCreditEntrySchema = trackArtistCreditEntrySchema.extend({
  artistId: z.string().min(1).max(128).nullish(),
});

export type HomeArtistCreditEntry = z.infer<typeof homeArtistCreditEntrySchema>;

/**
 * A Track as a home card: its header (id, title, cover, artist credit) plus
 * what a card adds: the length and the vocal range, which show its difficulty.
 */
export const homeTrackSchema = trackHeaderSchema.extend({
  artistCredit: z.array(homeArtistCreditEntrySchema).max(30),
  durationMs: z.number().int().nonnegative().nullable(),
  vocalRange: trackVocalRangeSchema.nullable(),
  /** Personal vocal rows say whether this range fits without transposing. */
  fitsVoice: z.boolean().optional(),
});

export type HomeTrack = z.infer<typeof homeTrackSchema>;

/**
 * A row title is a translation key plus its parameters, never translated text:
 * the web translates it with its own locale files.
 */
export const homeRowTitleSchema = z.object({
  key: z.string().min(1).max(128),
  params: z.record(z.string(), z.union([z.string().max(200), z.number()])),
});

export type HomeRowTitle = z.infer<typeof homeRowTitleSchema>;

const homeRowIdSchema = z.string().min(1).max(64);

/**
 * The `sponsored` flag is absent or false on every algorithmic row. When it is
 * true, clients show the sponsored-content notice on the row.
 */
export const homeHeroSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('hero'),
  sponsored: z.boolean().optional(),
  track: homeTrackSchema,
});

export type HomeHero = z.infer<typeof homeHeroSchema>;

export const HOME_CAROUSEL_MAX_ITEMS = 24;

/** Complete carousel size in the admin preview, independent of pin limits. */
export const HOME_PREVIEW_MAX_CAROUSEL_ITEMS = 48;

/** A weekly Top 10: at most ten Tracks, shown with big rank numbers. */
export const HOME_RANKED_MAX_ITEMS = 10;

export const homeCarouselRowSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('standard'),
  title: homeRowTitleSchema,
  sponsored: z.boolean().optional(),
  items: z.array(homeTrackSchema).min(1).max(HOME_CAROUSEL_MAX_ITEMS),
  /** Opaque cursor for the next horizontal item page. */
  nextItemsCursor: z.string().min(1).max(512).nullable().optional(),
});

export type HomeCarouselRow = z.infer<typeof homeCarouselRowSchema>;

/**
 * A carousel of by-voice Tracks: each card also shows the Track's Vocal range
 * as a bar. Every item carries a range, since the row exists to show it.
 */
export const homeVocalRangeTrackSchema = homeTrackSchema.extend({
  vocalRange: trackVocalRangeSchema,
});

export type HomeVocalRangeTrack = z.infer<typeof homeVocalRangeTrackSchema>;

export const homeVocalRangeRowSchema = homeCarouselRowSchema.extend({
  layout: z.literal('vocal-range'),
  items: z.array(homeVocalRangeTrackSchema).min(1).max(HOME_CAROUSEL_MAX_ITEMS),
});

export type HomeVocalRangeRow = z.infer<typeof homeVocalRangeRowSchema>;

/**
 * The daily target strip: how much practice time is left in the User's
 * Practice day and where their Streak stands. Algorithmic like every other
 * row, so `sponsored` is never set; the flag exists only so the layout shows
 * the sponsored notice if one ever arrives (see the layout registry test).
 */
export const homeDailyTargetRowSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('daily-target'),
  title: homeRowTitleSchema,
  sponsored: z.boolean().optional(),
  /** Practice seconds still missing to complete the day, never negative. */
  secondsLeft: z.number().int().min(0),
  /** The User's daily target in seconds. */
  targetSeconds: z.number().int().positive(),
  /** Consecutive completed Practice days, as `GET /v1/me/streak` reports. */
  streakDays: z.number().int().min(0),
  /** Whether the day already reached the target. */
  completedToday: z.boolean(),
});

export type HomeDailyTargetRow = z.infer<typeof homeDailyTargetRowSchema>;

/**
 * A ranked row (the weekly Top 10). Its items are best first, and the client
 * numbers them 1 to N in that order.
 */
export const homeRankedRowSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('ranked'),
  title: homeRowTitleSchema,
  sponsored: z.boolean().optional(),
  items: z.array(homeTrackSchema).min(1).max(HOME_RANKED_MAX_ITEMS),
});

export type HomeRankedRow = z.infer<typeof homeRankedRowSchema>;

/** Most tiles, artists or albums in one of the grid-style rows below. */
export const HOME_SHELF_MAX_ITEMS = 12;

/** A genre tile: the genre's display name, which the tile links to a search for. */
export const homeGenreTileSchema = z.object({
  name: z.string().min(1).max(100),
});

export type HomeGenreTile = z.infer<typeof homeGenreTileSchema>;

export const homeGenresRowSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('genres'),
  title: homeRowTitleSchema,
  sponsored: z.boolean().optional(),
  items: z.array(homeGenreTileSchema).min(1).max(HOME_SHELF_MAX_ITEMS),
});

export type HomeGenresRow = z.infer<typeof homeGenresRowSchema>;

/** An Artist as a featured artist: its ID (for its page) and its name. */
export const homeArtistSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
});

export type HomeArtist = z.infer<typeof homeArtistSchema>;

export const homeArtistsRowSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('artists'),
  title: homeRowTitleSchema,
  sponsored: z.boolean().optional(),
  items: z.array(homeArtistSchema).min(1).max(HOME_SHELF_MAX_ITEMS),
});

export type HomeArtistsRow = z.infer<typeof homeArtistsRowSchema>;

/**
 * An Album as a featured album: its ID (for its page), title, cover and year
 * (null when unknown).
 */
export const homeAlbumSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  coverArtUrl: z.string().min(1).max(2000).nullable(),
  year: z.number().int().nullable(),
});

export type HomeAlbum = z.infer<typeof homeAlbumSchema>;

export const homeAlbumsRowSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('albums'),
  title: homeRowTitleSchema,
  sponsored: z.boolean().optional(),
  items: z.array(homeAlbumSchema).min(1).max(HOME_SHELF_MAX_ITEMS),
});

export type HomeAlbumsRow = z.infer<typeof homeAlbumsRowSchema>;

/** A public Profile recommended in a personal home feed. */
export const homePersonSchema = z.object({
  id: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  image: z.string().min(1).max(2000).nullable(),
  commonTracks: z.number().int().min(3),
});

export type HomePerson = z.infer<typeof homePersonSchema>;

export const HOME_PEOPLE_MAX_ITEMS = 24;

/** Profiles that share practiced or favorited Tracks with the signed-in User. */
export const homePeopleRowSchema = z.object({
  id: homeRowIdSchema,
  layout: z.literal('people'),
  title: homeRowTitleSchema,
  sponsored: z.boolean().optional(),
  items: z.array(homePersonSchema).min(6).max(HOME_PEOPLE_MAX_ITEMS),
});

export type HomePeopleRow = z.infer<typeof homePeopleRowSchema>;

export const homeRowSchema = z.discriminatedUnion('layout', [
  homeHeroSchema,
  homeCarouselRowSchema,
  homeVocalRangeRowSchema,
  homeDailyTargetRowSchema,
  homeRankedRowSchema,
  homeGenresRowSchema,
  homeArtistsRowSchema,
  homeAlbumsRowSchema,
  homePeopleRowSchema,
]);

export type HomeRow = z.infer<typeof homeRowSchema>;

export const HOME_FEED_MAX_ROWS = 24;

/**
 * One page of the home feed. `version` identifies the content of the feed the
 * rows come from, and `nextCursor` (null on the last page) resumes the same
 * version, so paging never repeats or skips rows across a regeneration. The
 * audience tells whose feed it is: the shared public one, or the signed-in
 * User's personal blend.
 */
export const homeFeedSchema = z.object({
  audience: homeAudienceSchema,
  version: z.string().min(1).max(64),
  algorithmVersion: z.number().int().positive(),
  rows: z.array(homeRowSchema).max(HOME_FEED_MAX_ROWS),
  nextCursor: z.string().min(1).max(512).nullable(),
});

export type HomeFeed = z.infer<typeof homeFeedSchema>;

/**
 * A feed page as clients read it: the same envelope, but each row is kept
 * only when its layout and shape are known. A row this client doesn't know
 * is dropped alone, so a newer API never breaks an older app. The audience is
 * kept as a string so a caller can refuse a non-public one itself.
 */
export const homeFeedPageSchema = homeFeedSchema.extend({
  audience: z.string(),
  rows: z
    .array(z.unknown())
    .max(HOME_FEED_MAX_ROWS)
    .transform((rows) =>
      rows.flatMap((row) => {
        const parsed = homeRowSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

export type HomeFeedPage = z.output<typeof homeFeedPageSchema>;

/** One bounded horizontal page for a frozen Home Track Row. */
export const homeRowItemsPageSchema = z.discriminatedUnion('layout', [
  z.object({
    rowId: homeRowIdSchema,
    layout: z.literal('standard'),
    items: z.array(homeTrackSchema).min(1).max(12),
    nextCursor: z.string().min(1).max(512).nullable(),
  }),
  z.object({
    rowId: homeRowIdSchema,
    layout: z.literal('vocal-range'),
    items: z.array(homeVocalRangeTrackSchema).min(1).max(12),
    nextCursor: z.string().min(1).max(512).nullable(),
  }),
]);

export type HomeRowItemsPage = z.infer<typeof homeRowItemsPageSchema>;

export const homeRowItemsQuerySchema = z.object({
  cursor: z.string().min(1).max(512),
});

export type HomeRowItemsQuery = z.infer<typeof homeRowItemsQuerySchema>;

/**
 * `locale` picks the feed: omitted, the feed is `en`; an unsupported locale is
 * refused. A cursor names its own feed version, so it ignores the locale.
 */
export const homeFeedQuerySchema = z.object({
  locale: localeSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export type HomeFeedQuery = z.infer<typeof homeFeedQuerySchema>;

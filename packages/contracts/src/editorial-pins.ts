import { z } from 'zod';
import {
  HOME_FEED_MAX_ROWS,
  HOME_PREVIEW_MAX_CAROUSEL_ITEMS,
  homeCarouselRowSchema,
  homeFeedSchema,
  homeRowSchema,
  homeTrackSchema,
  homeVocalRangeRowSchema,
  homeVocalRangeTrackSchema,
} from './home.js';
import { LOCALES, type Locale, localeSchema } from './locales.js';
import { cursorPageSchema } from './pagination.js';
import { trackArtistCreditEntrySchema, trackCoverUrlSchema } from './tracks.js';

/**
 * Editorial pins: an admin's hero or row on the home feed, applied over the
 * algorithmic feed at read time (docs/adr/0012-editorial-pins-read-time-overlay.md).
 * Admin-only: these schemas never appear in a public response.
 */

export const EDITORIAL_PIN_KINDS = ['hero', 'row'] as const;
export const editorialPinKindSchema = z.enum(EDITORIAL_PIN_KINDS);
export type EditorialPinKind = z.infer<typeof editorialPinKindSchema>;

/** The layouts an admin can pin with: the hero, or a row layout. */
export const EDITORIAL_PIN_LAYOUTS = ['hero', 'standard'] as const;
export const editorialPinLayoutSchema = z.enum(EDITORIAL_PIN_LAYOUTS);
export type EditorialPinLayout = z.infer<typeof editorialPinLayoutSchema>;

/** Who sees a pin: everyone, or only visitors who are not signed in. */
export const EDITORIAL_PIN_AUDIENCES = ['everyone', 'visitors'] as const;
export const editorialPinAudienceSchema = z.enum(EDITORIAL_PIN_AUDIENCES);
export type EditorialPinAudience = z.infer<typeof editorialPinAudienceSchema>;

export const EDITORIAL_PIN_HISTORY_ACTIONS = [
  'CREATED',
  'UPDATED',
  'DELETED',
] as const;
export const editorialPinHistoryActionSchema = z.enum(
  EDITORIAL_PIN_HISTORY_ACTIONS,
);
export type EditorialPinHistoryAction = z.infer<
  typeof editorialPinHistoryActionSchema
>;

/** The position of the hero slot: row 0 of the feed. */
export const HERO_POSITION = 0;

export const EDITORIAL_PIN_MAX_TRACKS = 48;
/** The last row position: a feed holds at most 24 rows (0 is the hero slot). */
export const EDITORIAL_PIN_MAX_POSITION = 23;
export const EDITORIAL_PIN_MAX_PRIORITY = 1000;
export const EDITORIAL_PIN_TITLE_MAX_LENGTH = 120;

/** Where a pin's Tracks come from: each source kind. */
export const EDITORIAL_PIN_SOURCE_TYPES = [
  'tracks',
  'genre',
  'artist',
  'album',
] as const;

/**
 * Where a pin's Tracks come from. `tracks` is a list of specific Tracks, in the
 * order the admin set them. `genre`, `artist` and `album` are read when the feed
 * is read: the best Tracks of the genre or Artist, or the Album's Tracks in
 * album order.
 */
export const editorialPinSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tracks'),
    trackIds: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(EDITORIAL_PIN_MAX_TRACKS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'A Track appears once in a pin',
      }),
  }),
  z.object({
    type: z.literal('genre'),
    genre: z.string().trim().min(1).max(100),
  }),
  z.object({
    type: z.literal('artist'),
    artistId: z.string().min(1).max(128),
  }),
  z.object({
    type: z.literal('album'),
    albumId: z.string().min(1).max(128),
  }),
]);

export type EditorialPinSource = z.infer<typeof editorialPinSourceSchema>;

/** The sources read when the feed is read, which hold no Track list of their own. */
export type EditorialPinDynamicSource = Exclude<
  EditorialPinSource,
  { type: 'tracks' }
>;

/** The title a row shows in one locale. A hero keeps it for when it is demoted. */
export const editorialPinTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(EDITORIAL_PIN_TITLE_MAX_LENGTH);

export const editorialPinTitlesSchema = z.partialRecord(
  localeSchema,
  editorialPinTitleSchema,
);

export type EditorialPinTitles = z.infer<typeof editorialPinTitlesSchema>;

const isoDateSchema = z.iso.datetime({ offset: true });

const positionSchema = z.number().int().min(0).max(EDITORIAL_PIN_MAX_POSITION);
const prioritySchema = z.number().int().min(0).max(EDITORIAL_PIN_MAX_PRIORITY);

/** The state of a pin: every field an admin sets, as the API returns it. */
export const editorialPinStateSchema = z.object({
  kind: editorialPinKindSchema,
  layout: editorialPinLayoutSchema,
  source: editorialPinSourceSchema,
  position: positionSchema,
  priority: prioritySchema,
  audience: editorialPinAudienceSchema,
  /** `null` pins the hero or row in every locale. */
  locale: localeSchema.nullable(),
  /** `null` means the pin is live from the moment it is saved. */
  startsAt: isoDateSchema.nullable(),
  /** `null` means the pin stays until it is removed. */
  endsAt: isoDateSchema.nullable(),
  titles: editorialPinTitlesSchema,
  /** Marks the hero or row it produces as sponsored, for every audience. */
  sponsored: z.boolean(),
});

export type EditorialPinState = z.infer<typeof editorialPinStateSchema>;

const pinInputShape = {
  kind: editorialPinKindSchema,
  layout: editorialPinLayoutSchema,
  source: editorialPinSourceSchema,
  position: positionSchema,
  priority: prioritySchema.optional(),
  audience: editorialPinAudienceSchema.optional(),
  locale: localeSchema.nullable().optional(),
  startsAt: isoDateSchema.nullable().optional(),
  endsAt: isoDateSchema.nullable().optional(),
  titles: editorialPinTitlesSchema,
  sponsored: z.boolean().optional(),
};

/**
 * The rules a pin must satisfy as a whole: the kind and the layout agree, the
 * window ends after it starts, and every locale the pin serves has a title.
 */
const checkPinRules = (
  body: {
    kind: EditorialPinKind;
    position: number;
    layout: EditorialPinLayout;
    locale?: Locale | null | undefined;
    startsAt?: string | null | undefined;
    endsAt?: string | null | undefined;
    titles: EditorialPinTitles;
  },
  ctx: z.RefinementCtx,
): void => {
  if ((body.kind === 'hero') !== (body.layout === 'hero')) {
    ctx.addIssue({
      code: 'custom',
      path: ['layout'],
      message: 'A hero pin uses the hero layout, and a row pin a row layout',
    });
  }
  // The hero slot is row 0, so a hero pin's position is fixed to it.
  if (body.kind === 'hero' && body.position !== HERO_POSITION) {
    ctx.addIssue({
      code: 'custom',
      path: ['position'],
      message: `A hero pin takes the hero slot (position ${HERO_POSITION})`,
    });
  }
  if (
    body.startsAt &&
    body.endsAt &&
    Date.parse(body.endsAt) <= Date.parse(body.startsAt)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'The pin must end after it starts',
    });
  }
  const served: readonly Locale[] = body.locale ? [body.locale] : LOCALES;
  for (const locale of served) {
    if (!body.titles[locale]) {
      ctx.addIssue({
        code: 'custom',
        path: ['titles', locale],
        message: `A title is required for ${locale}`,
      });
    }
  }
};

/** `POST /v1/admin/home-pins`: a whole pin, checked as a whole. */
export const createEditorialPinBodySchema = z
  .object(pinInputShape)
  .superRefine(checkPinRules);

export type CreateEditorialPinBody = z.infer<
  typeof createEditorialPinBodySchema
>;

/**
 * `PATCH /v1/admin/home-pins/:pinId`: any subset of the fields. The API checks
 * the merged result against `createEditorialPinBodySchema`.
 */
export const updateEditorialPinBodySchema = z.object(pinInputShape).partial();

export type UpdateEditorialPinBody = z.infer<
  typeof updateEditorialPinBodySchema
>;

/** Who created or changed a pin, as the admin panel names them. */
export const editorialPinActorSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
});

export type EditorialPinActor = z.infer<typeof editorialPinActorSchema>;

export const editorialPinSchema = editorialPinStateSchema.extend({
  id: z.string().min(1).max(128),
  createdBy: editorialPinActorSchema.nullable(),
  updatedBy: editorialPinActorSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type EditorialPin = z.infer<typeof editorialPinSchema>;

/** Aggregate engagement for the row a pin produces during its running window. */
export const editorialPinMetricsSchema = z.object({
  pinId: z.string().min(1).max(128),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  clickThroughRate: z.number().nonnegative(),
});

export type EditorialPinMetrics = z.infer<typeof editorialPinMetricsSchema>;

export const editorialPinMetricsPageSchema = z.array(editorialPinMetricsSchema);

/** An admin-only preview of a saved, scheduled, or unsaved pin. */
export const homePinPreviewRequestSchema = z.object({
  pin: createEditorialPinBodySchema,
  pinId: z.string().min(1).max(128).optional(),
  locale: localeSchema,
  audience: z.enum(['visitor', 'signed-in']),
});

export type HomePinPreviewRequest = z.infer<typeof homePinPreviewRequestSchema>;

/** Preview rows keep a complete Pin while public Home stays paged. */
const homePinPreviewRowSchema = z.union([
  homeCarouselRowSchema.extend({
    items: z.array(homeTrackSchema).min(1).max(HOME_PREVIEW_MAX_CAROUSEL_ITEMS),
  }),
  homeVocalRangeRowSchema.extend({
    items: z
      .array(homeVocalRangeTrackSchema)
      .min(1)
      .max(HOME_PREVIEW_MAX_CAROUSEL_ITEMS),
  }),
  homeRowSchema,
]);

/** A complete bounded feed returned for preview, without public-feed paging. */
export const homePinPreviewResponseSchema = homeFeedSchema.extend({
  rows: z.array(homePinPreviewRowSchema).max(HOME_FEED_MAX_ROWS),
  nextCursor: z.null(),
});

export type HomePinPreviewResponse = z.infer<
  typeof homePinPreviewResponseSchema
>;

export const editorialPinPageSchema = cursorPageSchema(editorialPinSchema);

export type EditorialPinPage = z.infer<typeof editorialPinPageSchema>;

/** One entry of a pin's history: what changed, who changed it, the state after. */
export const editorialPinHistoryEntrySchema = z.object({
  id: z.string().min(1).max(128),
  pinId: z.string().min(1).max(128),
  action: editorialPinHistoryActionSchema,
  changedFields: z.array(z.string().min(1).max(64)),
  actor: editorialPinActorSchema.nullable(),
  /** The pin's state after the change (its last state for a deletion). */
  state: editorialPinStateSchema,
  createdAt: isoDateSchema,
});

export type EditorialPinHistoryEntry = z.infer<
  typeof editorialPinHistoryEntrySchema
>;

export const editorialPinHistoryPageSchema = cursorPageSchema(
  editorialPinHistoryEntrySchema,
);

export type EditorialPinHistoryPage = z.infer<
  typeof editorialPinHistoryPageSchema
>;

/** Route param of every `/v1/admin/home-pins/:pinId` route. */
export const editorialPinIdParamSchema = z.object({
  pinId: z.string().min(1).max(128),
});

export type EditorialPinIdParam = z.infer<typeof editorialPinIdParamSchema>;

/**
 * One Track the admin can pick for a pin: what the picker shows to pick it.
 * Only Tracks whose Processing completed are ever listed; a hero additionally
 * needs a cover, which the picker reads off `coverUrl`.
 */
export const pinTrackSummarySchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  artistCredit: z.array(trackArtistCreditEntrySchema).max(30),
  coverUrl: trackCoverUrlSchema.nullable(),
});

export type PinTrackSummary = z.infer<typeof pinTrackSummarySchema>;

/** `GET /v1/admin/tracks/search`: the matching Tracks, most relevant first. */
export const pinTrackSearchResultSchema = z.object({
  items: z.array(pinTrackSummarySchema).max(50),
});

export type PinTrackSearchResult = z.infer<typeof pinTrackSearchResultSchema>;

/** How many matches an autocomplete answer carries at most. */
export const PIN_TRACK_SEARCH_MAX_LIMIT = 20;

/**
 * Why a pin write refused a Track or a dynamic source, carried by each
 * `VALIDATION_FAILED` issue so clients translate it instead of showing the
 * English developer message.
 */
export const pinTrackIssueReasonSchema = z.enum([
  'TRACK_NOT_COMPLETED',
  'TRACK_NO_COVER',
  'SOURCE_NOT_FOUND',
  'SOURCE_INSUFFICIENT',
]);

export type PinTrackIssueReason = z.infer<typeof pinTrackIssueReasonSchema>;

/**
 * `GET /v1/admin/tracks/search`: either a text query (matches against the
 * title and the credited artist names) or the summaries of explicit IDs (for
 * the Tracks an edited pin already holds). `kind` keeps only the Tracks that
 * can appear in a pin of that kind (a hero needs a cover); without it every
 * completed Track qualifies.
 */
export const pinTrackSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    ids: z.string().max(6400).optional(),
    kind: editorialPinKindSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PIN_TRACK_SEARCH_MAX_LIMIT)
      .default(10),
  })
  .superRefine((query, ctx) => {
    const hasQuery = query.q !== undefined;
    const hasIds = query.ids !== undefined;
    if (hasQuery === hasIds) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide either q or ids',
      });
    }
    if (
      hasIds &&
      (query.ids ?? '').split(',').filter((id) => id.trim().length > 0).length >
        EDITORIAL_PIN_MAX_TRACKS
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${EDITORIAL_PIN_MAX_TRACKS} Track IDs can be summarized`,
      });
    }
  });

export type PinTrackSearchQuery = z.infer<typeof pinTrackSearchQuerySchema>;

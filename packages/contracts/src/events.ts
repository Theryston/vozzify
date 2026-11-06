import { z } from 'zod';
import { homeAudienceSchema } from './home.js';
import { localeSchema } from './locales.js';

/**
 * Engagement events (`POST /v1/events`): what visitors saw and clicked, stored
 * raw for later analysis. The module is generic; the home feed is the first
 * producer. See `docs/adr/0013-events-and-acquisition.md`.
 */

/** How many events one request carries at most; larger batches are refused. */
export const MAX_EVENTS_PER_BATCH = 50;

/**
 * The anonymous visitor the events came from. Kept in the browser's local
 * storage (no cookie) and sent with every batch, so a visitor's earlier events
 * join to the account they later create. Stored on the User at sign-up.
 */
export const visitorIdSchema = z.string().min(1).max(64);

export type VisitorId = z.infer<typeof visitorIdSchema>;

export const clickIdSchema = z.string().min(1).max(128);

const eventRowIdSchema = z.string().min(1).max(64);

/** The feed the row was seen in, so impressions join to the feed version. */
const eventFeedVersionSchema = z.string().min(1).max(64);

/** Identifies one browser page visit and each event across ingestion retries. */
const eventAttributionFields = {
  eventId: z.string().min(1).max(128).optional(),
  visitId: z.string().min(1).max(128).optional(),
  locale: localeSchema.optional(),
  audience: homeAudienceSchema.optional(),
};

/** A home row seen at least half visible for at least one second. */
export const homeRowImpressionEventSchema = z.object({
  ...eventAttributionFields,
  type: z.literal('home.row_impression'),
  rowId: eventRowIdSchema,
  feedVersion: eventFeedVersionSchema,
  algorithmVersion: z.number().int().positive(),
  /** The items on screen, with the position they were shown at. */
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        position: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(24),
});

export type HomeRowImpressionEvent = z.infer<
  typeof homeRowImpressionEventSchema
>;

/** A home card clicked. Sent asynchronously, never delaying the navigation. */
export const homeItemClickEventSchema = z.object({
  ...eventAttributionFields,
  type: z.literal('home.item_click'),
  /** Joins the click to the Track view opened by this link. */
  clickId: clickIdSchema.optional(),
  rowId: eventRowIdSchema,
  feedVersion: eventFeedVersionSchema,
  algorithmVersion: z.number().int().positive(),
  itemId: z.string().min(1).max(128),
  /** The position the item was shown at; absent for the hero. */
  position: z.number().int().nonnegative().optional(),
});

export type HomeItemClickEvent = z.infer<typeof homeItemClickEventSchema>;

export const eventSchema = z.discriminatedUnion('type', [
  homeRowImpressionEventSchema,
  homeItemClickEventSchema,
]);

export type HomeEvent = z.infer<typeof eventSchema>;

/** One `POST /v1/events` batch: the visitor plus their bounded event list. */
export const recordEventsBodySchema = z.object({
  visitorId: visitorIdSchema,
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

export type RecordEventsBody = z.infer<typeof recordEventsBodySchema>;

/** What the endpoint answers: how many of the batch was queued (202). */
export const recordEventsResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
});

export type RecordEventsResponse = z.infer<typeof recordEventsResponseSchema>;

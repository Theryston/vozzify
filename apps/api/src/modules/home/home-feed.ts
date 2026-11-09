import { localeSchema } from '@vozzify/contracts';
import { z } from 'zod';
import { homeCompositionCandidatesSchema } from './home-composition-candidates.js';
import { HOME_ALGORITHM_VERSION } from './home-rules.js';
import { homeStoredRowSchema } from './home-stored-row.js';

/**
 * A feed as it is stored in Redis: the response minus the cursor, which is
 * per request. Its `version` is a hash of the rows, so an unchanged feed keeps
 * its version and its paging cursors.
 */
export const storedHomeFeedSchema = z.object({
  audience: z.literal('public'),
  // The locale the feed was built for. A cursor resumes its feed, so the pins
  // it is overlaid with are that locale's. Optional: feeds stored before the
  // field existed read as the default locale.
  locale: localeSchema.optional(),
  version: z.string().min(1).max(64),
  algorithmVersion: z.number().int().positive(),
  rows: z.array(homeStoredRowSchema),
  // The bounded pool from the background build lets personal refreshes rank
  // Albums without rescanning the complete catalog for each User.
  albumCandidates: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        coverArtUrl: z.string().nullable(),
        year: z.number().int().nullable(),
        primaryType: z.string().nullable().optional(),
        secondaryTypes: z.array(z.string()).optional(),
        availableTracks: z.array(
          z.object({ id: z.string(), popularity: z.number() }),
        ),
      }),
    )
    .optional(),
  // Bounded internal candidates let visit composition release Rows excluded
  // later by live Pins or the 24-Row capacity.
  compositionCandidates: homeCompositionCandidatesSchema.optional(),
});

export type StoredHomeFeed = z.infer<typeof storedHomeFeedSchema>;

/**
 * The fallback for a request that finds no feed while another request builds
 * it: an empty home, never stored and never cached.
 */
export const minimalHomeFeed = (): StoredHomeFeed => ({
  audience: 'public',
  version: 'minimal',
  algorithmVersion: HOME_ALGORITHM_VERSION,
  rows: [],
});

/**
 * A personal snapshot as it is stored in Redis: the response minus the
 * cursor, plus when it was built. Its `version` hashes the User with the rows,
 * so it never collides with a public version and its cursors stay valid while
 * the snapshot is served. Pins are overlaid at read time, never stored here
 * (see docs/adr/0012-editorial-pins-read-time-overlay.md).
 */
export const storedPersonalHomeFeedSchema = storedHomeFeedSchema.extend({
  audience: z.literal('personal'),
  // The locale the snapshot was built for: snapshots are per locale, like the
  // public feeds.
  locale: localeSchema,
  generatedAt: z.string().datetime(),
});

export type StoredPersonalHomeFeed = z.infer<
  typeof storedPersonalHomeFeedSchema
>;

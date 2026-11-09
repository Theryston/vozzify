import {
  homeAlbumsRowSchema,
  homeArtistsRowSchema,
  homeCarouselRowSchema,
  homeDailyTargetRowSchema,
  homeGenresRowSchema,
  homeHeroSchema,
  homePeopleRowSchema,
  homeRankedRowSchema,
  homeTrackSchema,
  homeVocalRangeRowSchema,
  homeVocalRangeTrackSchema,
} from '@vozzify/contracts';
import { z } from 'zod';

/** Stored rows retain full membership while HTTP item pages stay at twelve. */
const STORED_TRACK_ROW_MAX_ITEMS = 48;

export const homeStoredRowSchema = z.discriminatedUnion('layout', [
  homeHeroSchema,
  homeCarouselRowSchema.extend({
    items: z.array(homeTrackSchema).min(1).max(STORED_TRACK_ROW_MAX_ITEMS),
  }),
  homeVocalRangeRowSchema.extend({
    items: z
      .array(homeVocalRangeTrackSchema)
      .min(1)
      .max(STORED_TRACK_ROW_MAX_ITEMS),
  }),
  homeDailyTargetRowSchema,
  homeRankedRowSchema,
  homeGenresRowSchema,
  homeArtistsRowSchema,
  homeAlbumsRowSchema,
  homePeopleRowSchema,
]);

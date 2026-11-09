import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import { trackViews } from '../../database/schema/track-views.js';
import { tracks } from '../../database/schema/tracks.js';
import type { TrackSignalCount } from './home-popularity.js';
import { HOME_STAGE2_PARAMETERS } from './home-stage2-scoring.js';

type RecentAttemptQuery = {
  trackIds: string[] | undefined;
  limit: number;
  since: Date;
  locale?: 'en' | 'pt-BR';
  offset?: number;
};

/** Weighted valid practice candidates, with paging applied after ranking. */
export const weightedRecentAttempts = (
  tx: TransactionHost<DatabaseAdapter>['tx'],
  options: RecentAttemptQuery,
): Promise<TrackSignalCount[]> => {
  const { trackIds, limit, since, locale, offset = 0 } = options;
  const filters = [
    hasCompletedProcessing(tracks.id),
    eq(practiceAttempts.forwardSkip, false),
    eq(practiceAttempts.bleedSuspected, false),
    gte(practiceAttempts.createdAt, since),
  ];
  if (trackIds) filters.push(inArray(practiceAttempts.trackId, trackIds));
  if (locale) filters.push(eq(trackViews.locale, locale));
  const perSinger = tx
    .select({
      trackId: practiceAttempts.trackId,
      userId: practiceAttempts.userId,
      attempts: sql<number>`count(*)::int`.mapWith(Number).as('attempts'),
    })
    .from(practiceAttempts)
    .innerJoin(tracks, eq(practiceAttempts.trackId, tracks.id))
    .leftJoin(trackViews, eq(trackViews.id, practiceAttempts.viewId))
    .where(and(...filters))
    .groupBy(practiceAttempts.trackId, practiceAttempts.userId)
    .as('home_recent_per_singer');
  const contribution = sql`sum(1 + ${HOME_STAGE2_PARAMETERS.repeatWeight}::numeric * least(${perSinger.attempts} - 1, ${HOME_STAGE2_PARAMETERS.repeatCap}))`;
  const volume = sql`sum(${perSinger.attempts})`;
  return tx
    .select({
      trackId: perSinger.trackId,
      count: sql<number>`${contribution}`.mapWith(Number),
      rawCount: sql<number>`${volume}`.mapWith(Number),
    })
    .from(perSinger)
    .groupBy(perSinger.trackId)
    .orderBy(desc(contribution), desc(volume), asc(perSinger.trackId))
    .limit(limit)
    .offset(offset);
};

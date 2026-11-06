import type { TransactionHost } from '@nestjs-cls/transactional';
import type { Locale } from '@vozzify/contracts';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { albumTracks } from '../../database/schema/albums.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { trackViews } from '../../database/schema/track-views.js';
import { HOME_STAGE2_PARAMETERS } from './home-stage2-scoring.js';

export const albumSingerContributions = (
  tx: TransactionHost<DatabaseAdapter>['tx'],
  albumIds: string[],
  since: Date,
  locale?: Locale,
) => {
  const candidateTrackIds = tx
    .selectDistinct({ trackId: albumTracks.trackId })
    .from(albumTracks)
    .where(inArray(albumTracks.albumId, albumIds))
    .as('album_candidate_track_ids');
  const userAttempts = tx
    .select({
      trackId: practiceAttempts.trackId,
      userId: practiceAttempts.userId,
      attempts: sql<number>`count(*)::int`.mapWith(Number).as('attempts'),
    })
    .from(practiceAttempts)
    .leftJoin(trackViews, eq(trackViews.id, practiceAttempts.viewId))
    .innerJoin(
      candidateTrackIds,
      eq(candidateTrackIds.trackId, practiceAttempts.trackId),
    )
    .where(
      and(
        eq(practiceAttempts.forwardSkip, false),
        eq(practiceAttempts.bleedSuspected, false),
        gte(practiceAttempts.createdAt, since),
        ...(locale ? [eq(trackViews.locale, locale)] : []),
      ),
    )
    .groupBy(practiceAttempts.trackId, practiceAttempts.userId)
    .as(
      locale ? 'locale_album_singer_attempts' : 'global_album_singer_attempts',
    );
  return tx
    .select({
      trackId: userAttempts.trackId,
      contribution:
        sql<number>`sum(1 + ${HOME_STAGE2_PARAMETERS.repeatWeight}::numeric * least(${userAttempts.attempts} - 1, ${HOME_STAGE2_PARAMETERS.repeatCap}))`
          .mapWith(Number)
          .as('contribution'),
    })
    .from(userAttempts)
    .groupBy(userAttempts.trackId)
    .as(
      locale
        ? 'locale_album_singer_contributions'
        : 'global_album_singer_contributions',
    );
};

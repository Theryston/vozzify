import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { trackFavorites } from '../../database/schema/track-favorites.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import { tracks } from '../../database/schema/tracks.js';
import {
  POPULARITY_WEIGHTS,
  SINGING_SIGNAL_WINDOW_DAYS,
} from './home-popularity.js';
import { windowSince } from './home-row-source-ranking.js';
import { HOME_STAGE2_PARAMETERS } from './home-stage2-scoring.js';

type HomeTx = TransactionHost<DatabaseAdapter>['tx'];

const singerScores = (tx: HomeTx, since: Date) => {
  const perSinger = tx
    .select({
      trackId: practiceAttempts.trackId,
      userId: practiceAttempts.userId,
      attempts: sql<number>`count(*)::int`.as('attempts'),
    })
    .from(practiceAttempts)
    .where(
      and(
        eq(practiceAttempts.forwardSkip, false),
        eq(practiceAttempts.bleedSuspected, false),
        gte(practiceAttempts.createdAt, since),
      ),
    )
    .groupBy(practiceAttempts.trackId, practiceAttempts.userId)
    .as('genre_per_singer');
  return tx
    .select({
      trackId: perSinger.trackId,
      contribution:
        sql<number>`sum(1 + ${HOME_STAGE2_PARAMETERS.repeatWeight}::numeric * least(${perSinger.attempts} - 1, ${HOME_STAGE2_PARAMETERS.repeatCap}))`.as(
          'contribution',
        ),
    })
    .from(perSinger)
    .groupBy(perSinger.trackId)
    .as('genre_singers');
};

const collectiveScores = (tx: HomeTx) => {
  const since = windowSince(SINGING_SIGNAL_WINDOW_DAYS);
  const singers = singerScores(tx, since);
  const favorites = tx
    .select({
      trackId: trackFavorites.trackId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(trackFavorites)
    .where(gte(trackFavorites.createdAt, since))
    .groupBy(trackFavorites.trackId)
    .as('genre_favorites');
  return tx
    .select({
      id: tracks.id,
      title: tracks.title,
      coverUrl: tracks.coverUrl,
      artistCredit: tracks.artistCredit,
      lengthMs: tracks.lengthMs,
      vocalRangeLowest: tracks.vocalRangeLowest,
      vocalRangeHighest: tracks.vocalRangeHighest,
      genres: tracks.genres,
      collectiveScore:
        sql<number>`${POPULARITY_WEIGHTS.trending} * ${tracks.trendingScore} + ${POPULARITY_WEIGHTS.attempt} * coalesce(${singers.contribution}, 0) + ${POPULARITY_WEIGHTS.favorite} * coalesce(${favorites.count}, 0)`
          .mapWith(Number)
          .as('collective_score'),
    })
    .from(tracks)
    .leftJoin(singers, eq(singers.trackId, tracks.id))
    .leftJoin(favorites, eq(favorites.trackId, tracks.id))
    .where(hasCompletedProcessing(tracks.id))
    .as('genre_collective_scores');
};

/** Background-only: the reference includes the entire positive completed catalog. */
@Injectable()
export class HomeGenreRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async findCollectiveGenrePool() {
    const tx = this.txHost.tx;
    const scores = collectiveScores(tx);
    const ranked = tx
      .select({
        id: scores.id,
        collectiveScore: scores.collectiveScore,
        position:
          sql<number>`row_number() over (order by ${scores.collectiveScore} desc, ${scores.id} asc)`.as(
            'position',
          ),
        positiveCount: sql<number>`count(*) over ()`.as('positive_count'),
      })
      .from(scores)
      .where(sql`${scores.collectiveScore} > 0`)
      .as('genre_reference');
    return tx
      .select({
        id: tracks.id,
        title: tracks.title,
        coverUrl: tracks.coverUrl,
        artistCredit: tracks.artistCredit,
        lengthMs: tracks.lengthMs,
        vocalRangeLowest: tracks.vocalRangeLowest,
        vocalRangeHighest: tracks.vocalRangeHighest,
        genres: tracks.genres,
        collectiveScore: ranked.collectiveScore,
      })
      .from(ranked)
      .innerJoin(tracks, eq(tracks.id, ranked.id))
      .where(
        sql`${ranked.position} <= ceil(${ranked.positiveCount}::numeric / 4)`,
      )
      .orderBy(desc(ranked.collectiveScore), asc(ranked.id));
  }
}

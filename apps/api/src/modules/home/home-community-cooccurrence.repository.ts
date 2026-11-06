import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.js';
import { practiceAttempts } from '../../database/schema/practice-attempts.js';
import { trackCooccurrences } from '../../database/schema/track-cooccurrences.js';
import { trackFavorites } from '../../database/schema/track-favorites.js';
import { trackProcessings } from '../../database/schema/track-processings.js';

/** Rebuilds the bounded, normalized co-occurrence ranking used by Home. */
export const refreshCommunityCooccurrence = async (
  tx: Database,
): Promise<void> => {
  const result = await tx.execute<{
    sourceTrackId: string;
    targetTrackId: string;
    singerCount: number;
    score: number;
  }>(sql`
      with signals as (
        select distinct attempts.user_id, attempts.track_id
        from ${practiceAttempts} attempts
        inner join ${trackProcessings} processing
          on processing.track_id = attempts.track_id
          and processing.status = 'COMPLETED'
        where attempts.forward_skip = false and attempts.bleed_suspected = false
        union
        select favorites.user_id, favorites.track_id
        from ${trackFavorites} favorites
        inner join ${trackProcessings} processing
          on processing.track_id = favorites.track_id
          and processing.status = 'COMPLETED'
      ), pairs as (
        select source.track_id as "sourceTrackId",
          target.track_id as "targetTrackId",
          count(distinct source.user_id)::int as "singerCount"
        from signals source
        inner join signals target on target.user_id = source.user_id
        where target.track_id <> source.track_id
        group by source.track_id, target.track_id
        having count(distinct source.user_id) >= 2
      ), track_counts as (
        select track_id, count(distinct user_id)::float as user_count
        from signals group by track_id
      ), scored as (
        select pairs.*,
          sqrt(source_count.user_count * target_count.user_count) as denominator
        from pairs
        inner join track_counts source_count
          on source_count.track_id = pairs."sourceTrackId"
        inner join track_counts target_count
          on target_count.track_id = pairs."targetTrackId"
      ), scored_pairs as (
        select "sourceTrackId", "targetTrackId", "singerCount",
          "singerCount"::float / denominator as score
        from scored
      ), ranked as (
        select "sourceTrackId", "targetTrackId", "singerCount", score,
          row_number() over (
            partition by "sourceTrackId"
            order by score desc, "singerCount" desc, "targetTrackId" asc
          ) as rank
        from scored_pairs
      )
      select "sourceTrackId", "targetTrackId", "singerCount", score
      from ranked where rank <= 48
  `);
  await tx.delete(trackCooccurrences);
  if (result.rows.length > 0) {
    await tx.insert(trackCooccurrences).values(result.rows);
  }
};

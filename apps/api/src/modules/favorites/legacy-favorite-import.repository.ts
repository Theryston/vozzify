import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { inArray, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { trackFavorites } from '../../database/schema/track-favorites.js';
import { users } from '../../database/schema/users.js';
import type { LegacyFavorite } from '../legacy-import/legacy-relationships.js';
import type { LegacyTrackResolution } from '../tracks/legacy-track-map.repository.js';

@Injectable()
export class LegacyFavoriteImportRepository {
  constructor(private readonly host: TransactionHost<DatabaseAdapter>) {}

  async importPage(
    favorites: LegacyFavorite[],
    resolutions: Map<string, LegacyTrackResolution>,
  ): Promise<{
    accepted: number;
    imported: number;
    deduplicated: number;
    skipped: number;
  }> {
    const rows = favorites.flatMap((favorite) => {
      const resolution = resolutions.get(favorite.trackId);
      if (resolution?.kind === 'mapped')
        return [{ ...favorite, destinationTrackId: resolution.trackId }];
      return [];
    });
    const grouped = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = JSON.stringify([row.userId, row.destinationTrackId]);
      const existing = grouped.get(key);
      if (!existing || comesFirst(row, existing)) grouped.set(key, row);
    }
    let imported = 0;
    for (const row of grouped.values()) {
      const result = await this.host.tx
        .insert(trackFavorites)
        .values({
          id: row.id,
          userId: row.userId,
          trackId: row.destinationTrackId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .onConflictDoUpdate({
          target: [trackFavorites.userId, trackFavorites.trackId],
          set: {
            id: sql`excluded.id`,
            createdAt: sql`excluded.created_at`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`excluded.created_at < ${trackFavorites.createdAt}
            or (excluded.created_at = ${trackFavorites.createdAt}
              and excluded.id collate "C" < ${trackFavorites.id} collate "C")`,
        })
        .returning({ inserted: sql<boolean>`xmax = 0` });
      imported += Number(result[0]?.inserted ?? false);
    }
    return {
      accepted: rows.length,
      imported,
      deduplicated: rows.length - imported,
      skipped: favorites.filter(
        (favorite) => resolutions.get(favorite.trackId)?.kind === 'skipped',
      ).length,
    };
  }

  async usernamesFor(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.host.tx
      .select({ username: users.username })
      .from(users)
      .where(inArray(users.id, userIds));
    return rows.flatMap((row) => (row.username ? [row.username] : []));
  }
}

const comesFirst = (
  candidate: LegacyFavorite,
  current: LegacyFavorite & { destinationTrackId: string },
): boolean =>
  candidate.createdAt < current.createdAt ||
  (candidate.createdAt.getTime() === current.createdAt.getTime() &&
    candidate.id < current.id);

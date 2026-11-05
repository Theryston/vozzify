import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DatabaseAdapter } from '../../database/database.js';
import { trackViews } from '../../database/schema/track-views.js';
import type { LegacyView } from '../legacy-import/legacy-relationships.js';

@Injectable()
export class LegacyTrackViewImportRepository {
  constructor(private readonly host: TransactionHost<DatabaseAdapter>) {}

  async importPage(
    views: LegacyView[],
    trackIds: Map<string, string>,
  ): Promise<{ imported: number; skipped: number }> {
    const values = views.flatMap((view) => {
      const trackId = trackIds.get(view.trackId);
      return trackId
        ? [
            {
              id: view.id,
              trackId,
              userId: view.userId,
              clickId: null,
              visitorId: null,
              locale: null,
              createdAt: view.createdAt,
              updatedAt: view.updatedAt,
            },
          ]
        : [];
    });
    let imported = 0;
    for (const value of values) {
      const rows = await this.host.tx
        .insert(trackViews)
        .values(value)
        .onConflictDoNothing({ target: trackViews.id })
        .returning({ id: trackViews.id });
      imported += rows.length;
    }
    return {
      imported,
      skipped: views.filter((view) => !trackIds.has(view.trackId)).length,
    };
  }
}

import { and, asc, eq, gt, gte, or, sql } from 'drizzle-orm';
import {
  type CatalogTransaction,
  withCatalogWriteLock,
} from '../../database/catalog-write-lock.js';
import type { Database } from '../../database/database.js';
import type { DatabaseSource } from '../../database/database-ref.js';
import { reimportState } from '../../database/schema/reimport-state.js';
import { trackAssociation } from '../../database/schema/track-association.js';

export type TrackAssociation = {
  mbid: string;
  trackId: string | null;
  businessScore?: number | null;
  revision?: number;
};

export type PendingTrackAssociation = {
  mbid: string;
  trackId: string | null;
  businessScore: number | null;
  revision: number;
};

export class TrackAssociationRepository {
  private readonly getServing: () => Database;
  private readonly getServingUrl: () => string;

  constructor(
    serving: DatabaseSource,
    servingUrl: string | (() => string) = '',
    private readonly nextCopy?: { db: Database; url: string },
  ) {
    this.getServing = typeof serving === 'function' ? serving : () => serving;
    this.getServingUrl =
      typeof servingUrl === 'function' ? servingUrl : () => servingUrl;
  }

  /** Acknowledges only after each live copy has durably stored retry work. */
  async put(association: TrackAssociation): Promise<boolean> {
    const serving = this.getServing();
    const servingUrl = this.getServingUrl();
    return withCatalogWriteLock(serving, async (transaction) => {
      const [state] = await transaction
        .select({ phase: reimportState.phase, detail: reimportState.detail })
        .from(reimportState)
        .where(eq(reimportState.id, true))
        .limit(1);
      if (state?.phase === 'switching') {
        return 'switching' as const;
      }
      const shouldMirror =
        this.nextCopy !== undefined &&
        this.nextCopy.url !== servingUrl &&
        (state?.phase === 'restoring' || state?.phase === 'indexing');
      const staleCopy =
        state?.phase === 'switched' &&
        state.detail !== null &&
        state.detail !== servingUrl;
      if (state?.phase === 'switching' || staleCopy) {
        return 'switching' as const;
      }
      if (shouldMirror && this.nextCopy !== undefined) {
        await withCatalogWriteLock(
          this.nextCopy.db,
          async (nextTransaction) => {
            await this.upsert(nextTransaction, association);
          },
        );
      }
      await this.upsert(transaction, association);
      return 'accepted' as const;
    }).then((outcome) => outcome === 'accepted');
  }

  async peekPending(
    limit: number,
    afterMbid?: string,
  ): Promise<PendingTrackAssociation[]> {
    const rows = await this.getServing()
      .select({
        mbid: trackAssociation.recordingMbid,
        trackId: trackAssociation.trackId,
        businessScore: trackAssociation.businessScore,
        revision: trackAssociation.revision,
      })
      .from(trackAssociation)
      .where(
        afterMbid === undefined
          ? eq(trackAssociation.pending, true)
          : and(
              eq(trackAssociation.pending, true),
              gt(trackAssociation.recordingMbid, afterMbid),
            ),
      )
      .orderBy(asc(trackAssociation.recordingMbid))
      .limit(limit);
    return rows;
  }

  async markIndexed(
    entries: readonly PendingTrackAssociation[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.getServing()
        .update(trackAssociation)
        .set({ pending: false })
        .where(
          and(
            eq(trackAssociation.recordingMbid, entry.mbid),
            eq(trackAssociation.revision, entry.revision),
            eq(trackAssociation.pending, true),
          ),
        );
    }
  }

  async transferTo(nextCopy: Database, batchSize: number): Promise<void> {
    let afterMbid: string | undefined;
    const serving = this.getServing();
    while (true) {
      const rows = await withCatalogWriteLock(serving, async () => {
        const page = await serving
          .select({
            mbid: trackAssociation.recordingMbid,
            trackId: trackAssociation.trackId,
            businessScore: trackAssociation.businessScore,
            revision: trackAssociation.revision,
          })
          .from(trackAssociation)
          .where(
            afterMbid === undefined
              ? undefined
              : gt(trackAssociation.recordingMbid, afterMbid),
          )
          .orderBy(asc(trackAssociation.recordingMbid))
          .limit(batchSize);
        if (page.length > 0) {
          await withCatalogWriteLock(nextCopy, async (transaction) => {
            for (const row of page) {
              await transaction
                .insert(trackAssociation)
                .values({
                  recordingMbid: row.mbid,
                  trackId: row.trackId,
                  businessScore: row.businessScore,
                  revision: row.revision,
                  pending: true,
                })
                .onConflictDoUpdate({
                  target: trackAssociation.recordingMbid,
                  set: {
                    trackId: row.trackId,
                    businessScore: row.businessScore,
                    revision: row.revision,
                    pending: true,
                  },
                  setWhere: gte(
                    sql`excluded.revision`,
                    trackAssociation.revision,
                  ),
                });
            }
          });
        }
        return page;
      });
      if (rows.length === 0) return;
      afterMbid = rows.at(-1)?.mbid ?? afterMbid;
    }
  }

  private async upsert(
    transaction: CatalogTransaction,
    association: TrackAssociation,
  ): Promise<void> {
    await transaction
      .insert(trackAssociation)
      .values({
        recordingMbid: association.mbid,
        trackId: association.trackId,
        businessScore: association.businessScore ?? null,
        revision: association.revision ?? 0,
        pending: true,
      })
      .onConflictDoUpdate({
        target: trackAssociation.recordingMbid,
        set: {
          trackId: sql`excluded.track_id`,
          businessScore: sql`excluded.business_score`,
          revision: sql`excluded.revision`,
          pending: true,
          updatedAt: new Date(),
        },
        setWhere: or(
          gt(sql`excluded.revision`, trackAssociation.revision),
          and(
            eq(sql`excluded.revision`, trackAssociation.revision),
            or(
              eq(sql`excluded.revision`, 0),
              sql`excluded.track_id is not distinct from ${trackAssociation.trackId}
                and excluded.business_score is not distinct from ${trackAssociation.businessScore}`,
            ),
          ),
        ),
      });
  }
}

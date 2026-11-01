import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, gt, inArray } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import { tracks } from '../../database/schema/tracks.js';

export type SearchTrackRow = {
  id: string;
  recordingMbid: string;
  title: string;
  artistCredit: { name: string; joinPhrase: string }[];
  coverUrl: string | null;
};

export type SearchIndexTrackRow = {
  id: string;
  title: string;
  artistCredit: { name: string; joinPhrase: string }[];
  updatedAt: Date;
};

@Injectable()
export class TracksSearchRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async findByIds(ids: readonly string[]): Promise<SearchTrackRow[]> {
    if (ids.length === 0) return [];
    return this.txHost.tx
      .select({
        id: tracks.id,
        recordingMbid: tracks.recordingMbid,
        title: tracks.title,
        artistCredit: tracks.artistCredit,
        coverUrl: tracks.coverUrl,
      })
      .from(tracks)
      .where(
        and(inArray(tracks.id, [...ids]), hasCompletedProcessing(tracks.id)),
      );
  }

  findIndexPage(
    afterId: string | undefined,
    limit: number,
  ): Promise<SearchIndexTrackRow[]> {
    return this.txHost.tx
      .select({
        id: tracks.id,
        title: tracks.title,
        artistCredit: tracks.artistCredit,
        updatedAt: tracks.updatedAt,
      })
      .from(tracks)
      .where(
        and(
          afterId ? gt(tracks.id, afterId) : undefined,
          hasCompletedProcessing(tracks.id),
        ),
      )
      .orderBy(asc(tracks.id))
      .limit(limit);
  }
}

import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { privateTracks } from '../../database/schema/private-tracks.js';

@Injectable()
export class PrivateTrackPracticeRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  findOwnedForHistory(userId: string, ids: string[]) {
    return this.txHost.tx
      .select({
        id: privateTracks.id,
        title: privateTracks.title,
        artist: privateTracks.artist,
        titleOverride: privateTracks.titleOverride,
        artistOverride: privateTracks.artistOverride,
        recordingLink: privateTracks.recordingLink,
      })
      .from(privateTracks)
      .where(
        and(eq(privateTracks.userId, userId), inArray(privateTracks.id, ids)),
      );
  }

  async lockOwned(userId: string, id: string) {
    const [row] = await this.txHost.tx
      .select({ processingStatus: privateTracks.processingStatus })
      .from(privateTracks)
      .where(and(eq(privateTracks.userId, userId), eq(privateTracks.id, id)))
      .for('key share');
    return row;
  }
}

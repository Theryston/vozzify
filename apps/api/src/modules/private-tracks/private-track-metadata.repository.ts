import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, isNull } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { privateTracks } from '../../database/schema/private-tracks.js';

@Injectable()
export class PrivateTrackMetadataRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async isOwner(userId: string, id: string): Promise<boolean> {
    const row = await this.txHost.tx.query.privateTracks.findFirst({
      where: and(eq(privateTracks.id, id), eq(privateTracks.userId, userId)),
      columns: { id: true },
    });
    return row !== undefined;
  }

  findPendingAudio(id: string) {
    return this.txHost.tx.query.privateTracks.findFirst({
      where: and(eq(privateTracks.id, id), isNull(privateTracks.recordingLink)),
      columns: { mediaObjectKey: true, durationMs: true },
    });
  }

  async saveOwnerMetadata(
    userId: string,
    id: string,
    values: Pick<
      typeof privateTracks.$inferInsert,
      'titleOverride' | 'artistOverride' | 'recordingLink'
    >,
  ): Promise<boolean> {
    const changed = await this.txHost.tx
      .update(privateTracks)
      .set(values)
      .where(and(eq(privateTracks.id, id), eq(privateTracks.userId, userId)))
      .returning({ id: privateTracks.id });
    return changed.length > 0;
  }

  async saveIdentification(
    id: string,
    recordingLink: NonNullable<typeof privateTracks.$inferInsert.recordingLink>,
  ): Promise<void> {
    await this.txHost.tx
      .update(privateTracks)
      .set({ recordingLink })
      .where(
        and(eq(privateTracks.id, id), isNull(privateTracks.recordingLink)),
      );
  }
}

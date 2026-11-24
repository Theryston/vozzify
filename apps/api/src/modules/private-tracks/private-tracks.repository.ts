import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, desc, eq } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { privateTracks } from '../../database/schema/private-tracks.js';

@Injectable()
export class PrivateTracksRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async list(userId: string) {
    return this.txHost.tx
      .select()
      .from(privateTracks)
      .where(eq(privateTracks.userId, userId))
      .orderBy(desc(privateTracks.createdAt), desc(privateTracks.id));
  }

  async save(input: typeof privateTracks.$inferInsert) {
    const inserted = await this.txHost.tx
      .insert(privateTracks)
      .values(input)
      .onConflictDoNothing({
        target: [privateTracks.userId, privateTracks.contentSha256],
      })
      .returning();
    if (inserted[0]) return inserted[0];
    const existing = await this.txHost.tx
      .select()
      .from(privateTracks)
      .where(
        and(
          eq(privateTracks.userId, input.userId),
          eq(privateTracks.contentSha256, input.contentSha256),
        ),
      );
    const row = existing[0];
    if (!row) throw new Error('Private audio deduplication failed');
    return row;
  }
}

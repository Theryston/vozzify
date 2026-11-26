import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { privateTracks } from '../../database/schema/private-tracks.js';

@Injectable()
export class PrivateYouTubeTracksRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  findOwnedVideo(userId: string, youtubeVideoId: string) {
    return this.txHost.tx.query.privateTracks.findFirst({
      where: and(
        eq(privateTracks.userId, userId),
        eq(privateTracks.youtubeVideoId, youtubeVideoId),
      ),
    });
  }

  async reserve(
    input: typeof privateTracks.$inferInsert & { youtubeVideoId: string },
  ) {
    const [inserted] = await this.txHost.tx
      .insert(privateTracks)
      .values(input)
      .onConflictDoNothing({
        target: [privateTracks.userId, privateTracks.youtubeVideoId],
      })
      .returning();
    const existing =
      inserted ??
      (await this.findOwnedVideo(input.userId, input.youtubeVideoId));
    if (!existing) throw new Error('Private YouTube deduplication failed');
    return existing;
  }
}

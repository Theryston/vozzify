import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  privateTrackNotes,
  privateTracks,
} from '../../database/schema/private-tracks.js';

@Injectable()
export class PrivateTracksRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  async listPage(
    userId: string,
    query: { after?: { createdAt: Date; id: string }; limit: number },
  ) {
    const cursor = query.after
      ? or(
          lt(privateTracks.createdAt, query.after.createdAt),
          and(
            eq(privateTracks.createdAt, query.after.createdAt),
            lt(privateTracks.id, query.after.id),
          ),
        )
      : undefined;
    return this.txHost.tx
      .select()
      .from(privateTracks)
      .where(
        cursor
          ? and(eq(privateTracks.userId, userId), cursor)
          : eq(privateTracks.userId, userId),
      )
      .orderBy(desc(privateTracks.createdAt), desc(privateTracks.id))
      .limit(query.limit + 1);
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

  findOwned(userId: string, id: string) {
    return this.txHost.tx.query.privateTracks.findFirst({
      where: and(eq(privateTracks.userId, userId), eq(privateTracks.id, id)),
    });
  }

  findById(id: string) {
    return this.txHost.tx.query.privateTracks.findFirst({
      where: eq(privateTracks.id, id),
    });
  }

  async updateProcessing(
    id: string,
    values: Partial<typeof privateTracks.$inferInsert>,
  ): Promise<boolean> {
    const updated = await this.txHost.tx
      .update(privateTracks)
      .set(values)
      .where(eq(privateTracks.id, id))
      .returning({ id: privateTracks.id });
    return updated.length > 0;
  }

  async replaceNotes(
    privateTrackId: string,
    notes: readonly { pitch: number; start: number; end: number }[],
  ): Promise<boolean> {
    const existing = await this.txHost.tx
      .select({ id: privateTracks.id })
      .from(privateTracks)
      .where(eq(privateTracks.id, privateTrackId))
      .limit(1);
    if (!existing[0]) return false;
    await this.txHost.tx
      .delete(privateTrackNotes)
      .where(eq(privateTrackNotes.privateTrackId, privateTrackId));
    if (notes.length) {
      await this.txHost.tx
        .insert(privateTrackNotes)
        .values(notes.map((note) => ({ privateTrackId, ...note })));
    }
    return true;
  }

  listNotes(privateTrackId: string) {
    return this.txHost.tx
      .select({
        pitch: privateTrackNotes.pitch,
        start: privateTrackNotes.start,
        end: privateTrackNotes.end,
      })
      .from(privateTrackNotes)
      .where(eq(privateTrackNotes.privateTrackId, privateTrackId))
      .orderBy(privateTrackNotes.start);
  }

  async isPrivateObjectReferenced(key: string): Promise<boolean> {
    const row = await this.txHost.tx.query.privateTracks.findFirst({
      where: or(
        eq(privateTracks.objectKey, key),
        eq(privateTracks.mediaObjectKey, key),
        eq(privateTracks.vocalsObjectKey, key),
        eq(privateTracks.pitchCurveObjectKey, key),
      ),
      columns: { id: true },
    });
    return row !== undefined;
  }
}

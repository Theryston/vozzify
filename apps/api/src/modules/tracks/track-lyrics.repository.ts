import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { createId } from '@paralleldrive/cuid2';
import { asc, eq } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  trackLyricLines,
  trackLyricWords,
} from '../../database/schema/track-lyrics.js';
import type { TimedLyricLine } from '../../integrations/elevenlabs/track-lyrics-lines.js';

/**
 * The Timed lyrics of Tracks (CONTEXT.md "Timed lyrics"): their lines and words.
 * It knows nothing of Processings: the stage that may write them is checked by
 * the service that calls it, in the same transaction.
 */
@Injectable()
export class TrackLyricsRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /**
   * Replaces the Track's lines and their words with these, in the caller's
   * transaction. An empty list clears them.
   */
  async replaceTimedLyrics(
    trackId: string,
    lines: readonly TimedLyricLine[],
  ): Promise<void> {
    // The lines' words go with them: the words reference their line.
    await this.txHost.tx
      .delete(trackLyricLines)
      .where(eq(trackLyricLines.trackId, trackId));
    const built = lines.map((line, position) => ({
      id: createId(),
      line,
      position,
    }));
    if (built.length === 0) {
      return;
    }
    await this.txHost.tx.insert(trackLyricLines).values(
      built.map(({ id, line, position }) => ({
        id,
        trackId,
        position,
        start: line.start,
        end: line.end,
      })),
    );
    await this.txHost.tx.insert(trackLyricWords).values(
      built.flatMap(({ id, line }) =>
        line.words.map((word, position) => ({
          trackId,
          lineId: id,
          position,
          text: word.text,
          start: word.start,
          end: word.end,
        })),
      ),
    );
  }

  /**
   * The Track's Timed lyrics: its lines with their words, in the order they are
   * sung. Lines and words come back in one relational query, not one per line.
   */
  async findTimedLyrics(trackId: string): Promise<TimedLyricLine[]> {
    const rows = await this.txHost.tx.query.trackLyricLines.findMany({
      where: eq(trackLyricLines.trackId, trackId),
      orderBy: [asc(trackLyricLines.position)],
      columns: { start: true, end: true },
      with: {
        words: {
          columns: { text: true, start: true, end: true },
          orderBy: [asc(trackLyricWords.position)],
        },
      },
    });
    return rows.map(({ start, end, words }) => ({
      start,
      end,
      words: words.map((word) => ({
        text: word.text,
        start: word.start,
        end: word.end,
      })),
    }));
  }
}

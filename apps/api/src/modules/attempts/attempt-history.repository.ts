import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../../database/database.js';
import { privatePracticeAttempts } from '../../database/schema/private-practice-attempts.js';
import type { PracticeAttemptReadRow } from './attempt-view.js';
import type { OwnAttemptCursor } from './own-attempt-cursor.js';

export type AttemptHistoryQuery = {
  userId: string;
  after: OwnAttemptCursor | undefined;
  limit: number;
};

type AttemptHistoryColumns = {
  userId: AnyPgColumn;
  createdAt: AnyPgColumn;
  id: AnyPgColumn;
};

export function attemptHistoryPage(
  table: AttemptHistoryColumns,
  { userId, after }: AttemptHistoryQuery,
) {
  // Cursor dates have millisecond precision even when Postgres kept a fraction.
  const savedAt = sql<Date>`date_trunc('milliseconds', ${table.createdAt})`;
  const owned = eq(table.userId, userId);
  const filter = after
    ? and(
        owned,
        or(
          lt(savedAt, new Date(after.createdAt)),
          and(
            sql`${savedAt} = ${new Date(after.createdAt)}`,
            lt(table.id, after.attemptId),
          ),
        ),
      )
    : owned;
  return { filter, order: [desc(savedAt), desc(table.id)] };
}

export async function listPrivateHistory(
  db: Pick<Database, 'select'>,
  options: AttemptHistoryQuery,
): Promise<PracticeAttemptReadRow[]> {
  const { filter, order } = attemptHistoryPage(
    privatePracticeAttempts,
    options,
  );
  const rows = await db
    .select()
    .from(privatePracticeAttempts)
    .where(and(filter, isNotNull(privatePracticeAttempts.privateTrackId)))
    .orderBy(...order)
    .limit(options.limit);
  return rows.flatMap((attempt) =>
    attempt.privateTrackId === null
      ? []
      : [{ ...attempt, trackId: attempt.privateTrackId, isPrivate: true }],
  );
}

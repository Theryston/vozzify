import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';

/**
 * Where the signed-in User's own attempt history resumes: the entry that ends
 * the previous page, newest first. The attempt ID breaks ties, so the order
 * is total.
 */
export type OwnAttemptCursor = {
  createdAt: string;
  attemptId: string;
};

const cursorTupleSchema = z.tuple([
  z.string().datetime(),
  z.string().min(1).max(128),
]);

/** Opaque to clients: a base64url JSON tuple of the cursor's two values. */
export const encodeOwnAttemptCursor = ({
  createdAt,
  attemptId,
}: OwnAttemptCursor): string =>
  Buffer.from(JSON.stringify([createdAt, attemptId]), 'utf8').toString(
    'base64url',
  );

/**
 * Decodes a cursor this API issued. Opaque means opaque: only the canonical
 * encoding of a cursor decodes, so raw IDs and tampered strings are refused
 * with `VALIDATION_FAILED` instead of silently listing from a random spot.
 */
export const decodeOwnAttemptCursor = (cursor: string): OwnAttemptCursor => {
  const invalid = () => new AppException('VALIDATION_FAILED', 'Invalid cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const tuple = cursorTupleSchema.safeParse(parsed);
  if (!tuple.success) {
    throw invalid();
  }
  const [createdAt, attemptId] = tuple.data;
  const decoded = { createdAt, attemptId };
  if (encodeOwnAttemptCursor(decoded) !== cursor) {
    throw invalid();
  }
  return decoded;
};

/**
 * The cursor that resumes after the page's last run, or null when no run
 * follows the page. `hasMore` tells whether the query found one more row.
 */
export const nextOwnAttemptCursor = (
  lastRun: { id: string; createdAt: Date } | undefined,
  hasMore: boolean,
): string | null =>
  hasMore && lastRun
    ? encodeOwnAttemptCursor({
        createdAt: lastRun.createdAt.toISOString(),
        attemptId: lastRun.id,
      })
    : null;

/** Merges the first results from two separately scoped queries. */
export function mergeAttemptPages<T>(
  publicRows: T[],
  privateRows: T[],
  attempt: (row: T) => { createdAt: Date; id: string },
  limit: number,
): T[] {
  if (privateRows.length === 0) return publicRows;
  if (publicRows.length === 0) return privateRows;
  return [...publicRows, ...privateRows]
    .sort((first, second) => {
      const one = attempt(first);
      const two = attempt(second);
      return (
        two.createdAt.getTime() - one.createdAt.getTime() ||
        two.id.localeCompare(one.id)
      );
    })
    .slice(0, limit);
}

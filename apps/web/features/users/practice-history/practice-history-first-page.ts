import 'server-only';

import {
  type PracticeAttemptHistoryPage,
  practiceAttemptHistoryPageSchema,
} from '@vozzify/contracts';
import { cache } from 'react';

import { isApiError } from '@/lib/api/api-error';
import { serverApi } from '@/lib/api/server';

import { PRACTICE_HISTORY_PAGE_SIZE } from './practice-history-page-size';

/**
 * The first page of a Profile's history, read on each request: runs change as
 * soon as a User practices, so the history is not cached across requests (the
 * `cache()` only shares one render's read). `undefined` when the
 * API cannot answer, so the list falls back to a browser request and says so
 * in place rather than failing the Profile. `null` when the owner hid the
 * section from visitors, which the section then leaves out.
 */
// Cached per request: the section and the owner's invitations read the same
// page while one render is in progress, and it is fetched once.
export const getPracticeHistoryFirstPage = cache(
  (username: string): Promise<PracticeAttemptHistoryPage | null | undefined> =>
    readFirstPage(username, false),
);

/**
 * The same page as the signed-in owner reads it: the request's cookies identify
 * the owner, so a section the owner hid comes back too. Reads the request.
 */
export const getOwnPracticeHistoryFirstPage = cache(
  (username: string): Promise<PracticeAttemptHistoryPage | null | undefined> =>
    readFirstPage(username, true),
);

async function readFirstPage(
  username: string,
  forwardCookies: boolean,
): Promise<PracticeAttemptHistoryPage | null | undefined> {
  return serverApi(`/users/${encodeURIComponent(username)}/attempts`, {
    schema: practiceAttemptHistoryPageSchema,
    query: {
      limit: PRACTICE_HISTORY_PAGE_SIZE,
      ...(forwardCookies ? { includePrivate: true } : {}),
    },
    forwardCookies,
  }).catch((error: unknown) =>
    isApiError(error) && error.code === 'NOT_FOUND' ? null : undefined,
  );
}

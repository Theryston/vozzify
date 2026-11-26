'use client';

import {
  type PracticeAttemptHistoryItem,
  type PracticeAttemptHistoryPage,
  practiceAttemptHistoryPageSchema,
} from '@vozzify/contracts';

import { browserApi } from '@/lib/api/browser';
import { cursorPagesQueryOptions } from '@/lib/cursor-pages-query';

import { practiceHistoryKey } from '../query-keys';
import { PRACTICE_HISTORY_PAGE_SIZE } from './practice-history-page-size';

/**
 * The Profile's history as shared cursor paging: the server-rendered first
 * page hydrates the cache, and "Show more" fetches the next one from the API.
 */
export function practiceHistoryQueryOptions({
  username,
  initialPage,
  owner = false,
}: {
  username: string;
  initialPage?: PracticeAttemptHistoryPage;
  owner?: boolean;
}) {
  const options = cursorPagesQueryOptions<PracticeAttemptHistoryItem>({
    queryKey: practiceHistoryKey(username, owner),
    fetchPage: ({ cursor, signal }) =>
      browserApi(`/users/${encodeURIComponent(username)}/attempts`, {
        schema: practiceAttemptHistoryPageSchema,
        query: {
          cursor,
          limit: PRACTICE_HISTORY_PAGE_SIZE,
          ...(owner ? { includePrivate: true } : {}),
        },
        signal,
      }),
    initialPage,
  });
  return owner
    ? { ...options, gcTime: 0, placeholderData: undefined }
    : options;
}

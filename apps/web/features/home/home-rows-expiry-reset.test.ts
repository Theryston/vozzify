import { QueryClient } from '@tanstack/react-query';
import type { HomeFeedPage } from '@vozzify/contracts';
import { describe, expect, it } from 'vitest';
import { resetHomeRowsAfterExpiredVisit } from './home-rows-query';
import { homeQueryKeys } from './query-keys';

const page = (version: string, nextCursor: string | null): HomeFeedPage => ({
  audience: 'public',
  version,
  algorithmVersion: 1,
  rows: [],
  nextCursor,
});

describe('resetHomeRowsAfterExpiredVisit', () => {
  it('replaces every old page with the fetched first page', () => {
    const queryClient = new QueryClient();
    const oldFirst = page('old-version-1234', 'old-cursor');
    const oldLater = page('old-version-1234', null);
    const fresh = page('new-version-1234', 'new-cursor');
    const key = homeQueryKeys.rows('en', oldFirst);
    queryClient.setQueryData(key, {
      pages: [oldFirst, oldLater],
      pageParams: [undefined, 'old-cursor'],
    });

    resetHomeRowsAfterExpiredVisit(queryClient, 'en', oldFirst, fresh);

    expect(queryClient.getQueryData(key)).toEqual({
      pages: [fresh],
      pageParams: [undefined],
    });
  });
});

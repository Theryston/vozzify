import type { HomeFeedPage } from '@vozzify/contracts';
import { describe, expect, it, vi } from 'vitest';

import { useHomeRows } from './use-home-rows';

const useInfiniteQuery = vi.fn();

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useInfiniteQuery: (...args: unknown[]) => useInfiniteQuery(...args),
}));

const page: HomeFeedPage = {
  audience: 'public',
  version: 'a1b2c3d4e5f60718',
  algorithmVersion: 1,
  rows: [],
  nextCursor: 'a1b2c3d4e5f60718.6',
};

describe('useHomeRows', () => {
  it('queries the rows of the locale, seeded with the first page', () => {
    const result = { data: 'query result' };
    useInfiniteQuery.mockReturnValue(result);

    expect(useHomeRows('pt-BR', page)).toBe(result);
    expect(useInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['home', 'rows', 'pt-BR', 'public', 'a1b2c3d4e5f60718'],
        initialData: { pages: [page], pageParams: [undefined] },
      }),
    );
  });
});

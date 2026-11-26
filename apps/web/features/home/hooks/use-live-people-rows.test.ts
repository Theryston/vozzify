import type { HomeFeedPage, HomePeopleRow } from '@vozzify/contracts';
import { beforeEach, expect, it, vi } from 'vitest';
import { HomeVisitRestartError } from '../home-visit-restart';
import { useLivePeopleRows } from './use-live-people-rows';

const { useQueries, fetchHomeRowsPage } = vi.hoisted(() => ({
  useQueries: vi.fn(),
  fetchHomeRowsPage: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQueries }));
vi.mock('../home-rows-query', () => ({ fetchHomeRowsPage }));

const people: HomePeopleRow = {
  id: 'singers',
  layout: 'people',
  title: { key: 'home.rows.peopleWhoSingWhatYouSing', params: {} },
  items: [
    {
      id: 'user',
      username: 'user',
      name: 'User',
      commonTracks: 1,
      image: null,
    },
  ],
};
const page: HomeFeedPage = {
  audience: 'personal',
  version: 'v1',
  algorithmVersion: 1,
  nextCursor: null,
  rows: [people],
};
const feed = { pages: [page], pageParams: [undefined] };

beforeEach(() => {
  useQueries.mockReturnValue([]);
});

it('starts with the People already rendered and fetches one batch for their page', () => {
  const signal = new AbortController().signal;
  useQueries.mockImplementation(
    ({
      queries,
    }: {
      queries: {
        enabled: boolean;
        queryFn: (arg: { signal: AbortSignal }) => Promise<HomeFeedPage>;
      }[];
    }) => {
      expect(queries.map((query) => query.enabled)).toEqual([true, false]);
      return queries
        .filter((query) => query.enabled)
        .map((query) => ({
          data: undefined,
          promise: query.queryFn({ signal }),
        }));
    },
  );
  expect(
    useLivePeopleRows('en', {
      pages: [page, { ...page, rows: [] }],
      pageParams: ['frozen', undefined],
    }),
  ).toEqual([people]);
  expect(fetchHomeRowsPage).toHaveBeenCalledExactlyOnceWith({
    locale: 'en',
    cursor: 'frozen',
    signal,
  });
});

it('takes the latest people and keeps the other rows of the visit', () => {
  const fresh = { ...people, items: [] };
  const other = {
    id: 'tracks',
    layout: 'standard' as const,
    title: people.title,
    items: [],
  };
  useQueries.mockReturnValue([{ data: { ...page, rows: [fresh] } }]);
  expect(
    useLivePeopleRows('en', {
      ...feed,
      pages: [{ ...page, rows: [other, people] }],
    }),
  ).toEqual([other, fresh]);
});

it('removes people who disappeared and drops personal rows when the visitor signs out', () => {
  useQueries.mockReturnValue([{ data: { ...page, rows: [] } }]);
  expect(useLivePeopleRows('en', feed)).toEqual([]);
  useQueries.mockReturnValue([{ data: { ...page, audience: 'public' } }]);
  expect(useLivePeopleRows('en', feed)).toEqual([]);
});

it('reads the fresh feed attached to an expired cursor', () => {
  useQueries.mockReturnValue([
    { data: page, error: new HomeVisitRestartError({ ...page, rows: [] }) },
  ]);
  expect(useLivePeopleRows('pt-BR', feed)).toEqual([]);
});

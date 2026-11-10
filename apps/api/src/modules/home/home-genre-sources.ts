import type { HomeGenreRepository } from './home-genre.repository.js';
import { GENRE_ROW_TITLE_KEY, genreRowId } from './home-genre-rows.js';
import {
  type HomeCandidate,
  type HomeRowSource,
  toHomeCandidate,
} from './home-row-sources.js';

export const createGenreRowSources = async (
  repository: HomeGenreRepository,
): Promise<HomeRowSource[]> => {
  const pool = await repository.findCollectiveGenrePool();
  const byGenre = new Map<string, HomeCandidate[]>();
  for (const record of pool) {
    const candidate = {
      ...toHomeCandidate(record),
      collectiveScore: record.collectiveScore,
    };
    for (const genre of new Set(record.genres)) {
      const items = byGenre.get(genre) ?? [];
      items.push(candidate);
      byGenre.set(genre, items);
    }
  }
  return [...byGenre].map(([genre, items]) => ({
    id: genreRowId(genre),
    genre,
    layout: 'standard',
    title: { key: GENRE_ROW_TITLE_KEY, params: { genre } },
    load: async () => items,
    loadPage: async () => ({ items, hasMore: false }),
  }));
};

import { createHash } from 'node:crypto';
import type { LegacyFavorite, LegacyView } from './legacy-relationships.js';
import type { LegacySourceSnapshot } from './legacy-source.repository.js';

/** Keep checkpoint bytes stable across import, inspection and source pagination. */
export const personalSourceFingerprint = async (
  source: Pick<LegacySourceSnapshot, 'practicePage' | 'visibility'>,
) => {
  const hash = createHash('sha256');
  let cursor: string | null = null;
  let practiceDays = 0;
  for (;;) {
    const page = await source.practicePage(cursor);
    if (page.length === 0) break;
    for (const row of page) hash.update(JSON.stringify(row));
    practiceDays += page.length;
    cursor = page.at(-1)?.id ?? null;
  }
  const visibility = await source.visibility();
  for (const row of visibility) hash.update(JSON.stringify(row));
  return { digest: hash.digest('hex'), practiceDays, visibility };
};

export const relationshipSourceFingerprint = async (
  source: Pick<LegacySourceSnapshot, 'favoritePage' | 'viewPage'>,
  observe?: (
    label: 'favorites' | 'views',
    row: { id: string; trackId: string },
  ) => void,
) => {
  const hash = createHash('sha256');
  const counts = { favorites: 0, views: 0 };
  for (const { label, nextPage } of [
    {
      label: 'favorites',
      nextPage: (cursor: string | null) => source.favoritePage(cursor),
    },
    {
      label: 'views',
      nextPage: (cursor: string | null) => source.viewPage(cursor),
    },
  ] as const) {
    hash.update(`${label}\0`);
    let cursor: string | null = null;
    for (;;) {
      const page: (LegacyFavorite | LegacyView)[] = await nextPage(cursor);
      if (page.length === 0) break;
      for (const row of page) {
        hash.update(`${JSON.stringify(row)}\0`);
        observe?.(label, row);
      }
      counts[label] += page.length;
      cursor = page.at(-1)?.id ?? null;
    }
  }
  return { digest: hash.digest('hex'), ...counts };
};

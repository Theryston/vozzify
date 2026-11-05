import type { LegacySourceSnapshot } from './legacy-source.repository.js';
import {
  personalSourceFingerprint,
  relationshipSourceFingerprint,
} from './legacy-source-fingerprints.js';

const pages = async <T extends { id: string }>(
  read: (cursor: string | null) => Promise<T[]>,
): Promise<T[]> => {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await read(cursor);
    if (page.length === 0) return rows;
    rows.push(...page);
    cursor = page.at(-1)?.id ?? null;
  }
};

/** Source details stay inside the read-only transaction; reports contain no sign-in credentials. */
export const cutoverInventory = async (source: LegacySourceSnapshot) => {
  const users = await source.validate();
  const recordings = await source.validateRecordingSource();
  const personal = await personalSourceFingerprint(source);
  const relationshipsRows: Record<
    'favorites' | 'views',
    { id: string; trackId: string }[]
  > = { favorites: [], views: [] };
  const relationships = await relationshipSourceFingerprint(
    source,
    (label, { id, trackId }) => {
      relationshipsRows[label].push({ id, trackId });
    },
  );
  return {
    fingerprints: {
      users: users.digest,
      personal: personal.digest,
      recordings: recordings.digest,
      relationships: relationships.digest,
    },
    inventory: {
      users: users.users,
      accounts: users.accounts,
      errors: users.errors,
      practiceDays: personal.practiceDays,
      favorites: relationships.favorites,
      views: relationships.views,
      favoriteRows: relationshipsRows.favorites,
      viewRows: relationshipsRows.views,
      tracks: (await pages((cursor) => source.recordingPage(cursor))).map(
        (row) => row.id,
      ),
      artists: (await pages((cursor) => source.artistPage(cursor))).map(
        (row) => row.id,
      ),
      albums: (await pages((cursor) => source.albumPage(cursor))).map(
        (row) => row.id,
      ),
    },
  };
};

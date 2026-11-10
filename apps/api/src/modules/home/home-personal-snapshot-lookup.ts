import type { Locale } from '@vozzify/contracts';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import type { PersonalHomeStore } from './home-personal.store.js';
import { personalHomeVersionFromStoredRows } from './home-personal-version.js';

export const findPersonalSnapshotVersion = async (
  snapshots: PersonalHomeStore | undefined,
  userId: string,
  locale: Locale,
  version: string,
): Promise<StoredPersonalHomeFeed | undefined> => {
  const current = await snapshots?.readCurrent(userId, locale);
  if (current?.version === version) return current;
  const retired = await snapshots?.readRetired(version);
  if (!retired) return undefined;
  return personalHomeVersionFromStoredRows(
    userId,
    retired.locale,
    retired.algorithmVersion,
    retired.rows,
  ) === version
    ? retired
    : undefined;
};

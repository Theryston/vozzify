import type { HomeFeedPage, HomeRow } from '@vozzify/contracts';
import { homeFeedPageSchema } from '@vozzify/contracts';
import request from 'supertest';
import { expect } from 'vitest';
import { practiceAttempts } from '../../src/database/schema/practice-attempts.js';
import { trackFavorites } from '../../src/database/schema/track-favorites.js';
import { PersonalHomeRepository } from '../../src/modules/home/home-personal.repository.js';
import { PersonalHomeBuilder } from '../../src/modules/home/home-personal-builder.service.js';
import { createAuthClient } from './auth.js';
import type { TestApp } from './create-test-app.js';
import { homeInitialRowContents } from './home-initial-row-contents.js';
import {
  attemptValue,
  createHomeDiscoveryFixture,
} from './home-personal-discovery-fixtures.js';

type SignInAs = (
  username: string,
  email: string,
) => Promise<{
  user: { id: string };
  client: ReturnType<typeof createAuthClient>;
}>;
type Scenario = {
  testApp: TestApp;
  signInAs: SignInAs;
  refreshUser: (userId: string) => Promise<unknown>;
};

const readEveryPage = async (
  fetchPage: (cursor?: string) => Promise<{ body: unknown }>,
): Promise<HomeFeedPage[]> => {
  const pages: HomeFeedPage[] = [];
  let cursor: string | undefined;
  do {
    const page = homeFeedPageSchema.parse((await fetchPage(cursor)).body);
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return pages;
};

const rowsOf = (pages: HomeFeedPage[]): HomeRow[] =>
  pages.flatMap((page) => page.rows as HomeRow[]);

const layoutsOf = (pages: HomeFeedPage[]) => [
  ...new Set(rowsOf(pages).map((row) => row.layout)),
];

const itemIdsOf = (rows: HomeRow[], id: string): string[] => {
  const row = rows.find((candidate) => candidate.id === id);
  return row?.layout === 'standard' ? row.items.map((track) => track.id) : [];
};

const assertEligibleDiscoveryRows = (
  rows: HomeRow[],
  masteredIds: ReadonlySet<string>,
  categoryTrackIds: ReadonlySet<string>,
): void => {
  const emittedIds = rows
    .filter(
      (row) =>
        !['top-10-week', 'continue-singing', 'sing-again'].includes(row.id),
    )
    .flatMap((row) =>
      row.layout === 'hero'
        ? [row.track.id]
        : row.layout === 'standard' || row.layout === 'vocal-range'
          ? row.items.map((track) => track.id)
          : [],
    );
  expect(new Set(emittedIds).size).toBe(emittedIds.length);
  expect(emittedIds.every((id) => !masteredIds.has(id))).toBe(true);
  expect(emittedIds.every((id) => categoryTrackIds.has(id))).toBe(true);
};

const assertSparseRows = async (
  testApp: TestApp,
  client: ReturnType<typeof createAuthClient>,
  userId: string,
  refreshUser: Scenario['refreshUser'],
): Promise<Set<string>> => {
  const publicPages = await readEveryPage((cursor) =>
    request(testApp.app.getHttpServer()).get(
      cursor ? `/v1/home?cursor=${cursor}` : '/v1/home',
    ),
  );
  expect(
    itemIdsOf(rowsOf(publicPages), 'trending-today').length,
  ).toBeGreaterThanOrEqual(6);
  const sparsePages = await readEveryPage((cursor) =>
    client.get(cursor ? `/v1/home?cursor=${cursor}` : '/v1/home'),
  );
  expect(rowsOf(sparsePages).map((row) => row.id)).toEqual(
    rowsOf(publicPages).map((row) => row.id),
  );
  expect(rowsOf(sparsePages).map(homeInitialRowContents)).toEqual(
    rowsOf(publicPages).map(homeInitialRowContents),
  );
  const publicExpanded = rowsOf(publicPages).filter((row) =>
    ['trending-today', 'new-tracks'].includes(row.id),
  );
  expect(publicExpanded).toHaveLength(2);
  for (const row of publicExpanded) {
    expect(row.layout).toBe('standard');
    if (row.layout === 'standard') {
      expect(row.items).toHaveLength(12);
      expect(row.nextItemsCursor).toEqual(expect.any(String));
    }
  }
  for (const row of rowsOf(sparsePages)) {
    if (row.layout === 'standard' || row.layout === 'vocal-range') {
      expect(row.items.length).toBeLessThanOrEqual(12);
      expect(row.nextItemsCursor).toBeUndefined();
    }
  }
  const required = ['genres', 'artists', 'albums', 'ranked', 'vocal-range'];
  expect(layoutsOf(publicPages)).toEqual(expect.arrayContaining(required));
  await refreshUser(userId);
  const rebuilt = await readEveryPage((cursor) =>
    client.get(cursor ? `/v1/home?cursor=${cursor}` : '/v1/home'),
  );
  const ids = rowsOf(rebuilt).map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  const voiceRows = (pages: HomeFeedPage[]) =>
    rowsOf(pages).filter((row) => row.layout === 'vocal-range');
  expect(voiceRows(rebuilt).map(homeInitialRowContents)).toEqual(
    voiceRows(publicPages).map(homeInitialRowContents),
  );
  expect(layoutsOf(rebuilt)).toEqual(expect.arrayContaining(required));
  return new Set(itemIdsOf(rowsOf(publicPages), 'trending-today'));
};

const masterInitialPublicTracks = async (
  testApp: TestApp,
  userId: string,
  categoryTracks: Awaited<
    ReturnType<typeof createHomeDiscoveryFixture>
  >['categoryTracks'],
  initialPublicIds: ReadonlySet<string>,
): Promise<{
  masteredIds: Set<string>;
  initialPublicIds: ReadonlySet<string>;
}> => {
  const tracksById = new Map(categoryTracks.map((track) => [track.id, track]));
  const mastered = [...initialPublicIds].flatMap((id) => {
    const track = tracksById.get(id);
    return track ? [track] : [];
  });
  const firstDay = Date.now() - mastered.length * 24 * 60 * 60 * 1_000;
  await testApp.db
    .insert(practiceAttempts)
    .values(
      mastered.map((track, index) =>
        attemptValue(
          userId,
          track.id,
          0.95,
          new Date(firstDay + index * 24 * 60 * 60 * 1_000),
        ),
      ),
    );
  await testApp.db
    .insert(trackFavorites)
    .values(
      categoryTracks
        .slice(70, 73)
        .map((track) => ({ userId, trackId: track.id })),
    );
  return {
    masteredIds: new Set(mastered.map((track) => track.id)),
    initialPublicIds,
  };
};

const assertEstablishedReplenishment = async (options: {
  testApp: TestApp;
  collectiveUserId: string;
  client: ReturnType<typeof createAuthClient>;
  userId: string;
  categoryTracks: Awaited<
    ReturnType<typeof createHomeDiscoveryFixture>
  >['categoryTracks'];
  history: {
    masteredIds: ReadonlySet<string>;
    initialPublicIds: ReadonlySet<string>;
  };
  refreshUser: Scenario['refreshUser'];
}): Promise<void> => {
  const {
    testApp,
    collectiveUserId,
    client,
    userId,
    categoryTracks,
    history,
    refreshUser,
  } = options;
  const activityAt = new Date();
  await testApp.db
    .insert(practiceAttempts)
    .values(
      categoryTracks
        .slice(58)
        .map((track) =>
          attemptValue(collectiveUserId, track.id, 0.5, activityAt),
        ),
    );
  await refreshUser(userId);
  await testApp.app.get(PersonalHomeBuilder).refreshCommunityCooccurrence();
  const cooccurrence = await testApp.app
    .get(PersonalHomeRepository)
    .findCommunityCooccurrence([...history.masteredIds].slice(0, 3));
  expect(cooccurrence.length).toBeGreaterThan(0);
  expect(cooccurrence.every(({ score }) => score > 0 && score <= 1)).toBe(true);
  const pages = await readEveryPage((cursor) =>
    client.get(cursor ? `/v1/home?cursor=${cursor}` : '/v1/home'),
  );
  const rows = rowsOf(pages);
  expect(layoutsOf(pages)).toEqual(
    expect.arrayContaining(['genres', 'artists', 'albums', 'ranked']),
  );
  expect(rows.find((row) => row.id === 'trending-today')?.layout).toBe(
    'standard',
  );
  expect(itemIdsOf(rows, 'trending-today').length).toBeGreaterThanOrEqual(6);
  expect(itemIdsOf(rows, 'trending-today').length).toBeLessThanOrEqual(12);
  assertEligibleDiscoveryRows(
    rows,
    history.masteredIds,
    new Set(categoryTracks.map((track) => track.id)),
  );
  const replenishedIds = itemIdsOf(rows, 'trending-today');
  expect(replenishedIds.some((id) => !history.initialPublicIds.has(id))).toBe(
    true,
  );
  expect(replenishedIds.every((id) => !history.masteredIds.has(id))).toBe(true);
};

const assertGenuineExhaustion = async (options: {
  testApp: TestApp;
  client: ReturnType<typeof createAuthClient>;
  userId: string;
  categoryTracks: Awaited<
    ReturnType<typeof createHomeDiscoveryFixture>
  >['categoryTracks'];
  refreshUser: Scenario['refreshUser'];
}): Promise<void> => {
  const { testApp, client, userId, categoryTracks, refreshUser } = options;
  const now = new Date();
  await testApp.db
    .insert(practiceAttempts)
    .values(
      categoryTracks.map((track) => attemptValue(userId, track.id, 0.95, now)),
    );
  await refreshUser(userId);
  const pages = await readEveryPage((cursor) =>
    client.get(cursor ? `/v1/home?cursor=${cursor}` : '/v1/home'),
  );
  expect(
    rowsOf(pages)
      .filter((row) =>
        ['trending-today', 'most-sung', 'new-tracks'].includes(row.id),
      )
      .map((row) => row.id),
  ).toEqual([]);
};

export const verifyPersonalCategoryReplenishment = async (
  options: Scenario,
): Promise<void> => {
  const { testApp, signInAs, refreshUser } = options;
  const { categoryTracks, collectiveUserId } = await createHomeDiscoveryFixture(
    testApp,
    signInAs,
  );
  const { user, client } = await signInAs(
    'category_sparse',
    'category-sparse@example.com',
  );
  const initialPublicIds = await assertSparseRows(
    testApp,
    client,
    user.id,
    refreshUser,
  );
  const history = await masterInitialPublicTracks(
    testApp,
    user.id,
    categoryTracks,
    initialPublicIds,
  );
  await assertEstablishedReplenishment({
    testApp,
    collectiveUserId,
    client,
    userId: user.id,
    categoryTracks,
    history,
    refreshUser,
  });
  await assertGenuineExhaustion({
    testApp,
    client,
    userId: user.id,
    categoryTracks,
    refreshUser,
  });
};

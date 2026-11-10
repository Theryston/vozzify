import type { HomeRow } from '@vozzify/contracts';
import { homeRowItemsPageSchema } from '@vozzify/contracts';
import request from 'supertest';
import { expect } from 'vitest';
import type { createAuthClient } from './auth.js';
import type { TestApp } from './create-test-app.js';

type TrackRow = Extract<HomeRow, { layout: 'standard' | 'vocal-range' }>;

const completeIds = async (
  row: TrackRow,
  fetchPage: (cursor: string) => PromiseLike<{ body: unknown }>,
): Promise<string[]> => {
  expect(row.items.length).toBeLessThanOrEqual(12);
  const ids = row.items.map(({ id }) => id);
  const seenCursors = new Set<string>();
  let cursor = row.nextItemsCursor;
  while (cursor) {
    expect(seenCursors.has(cursor)).toBe(false);
    seenCursors.add(cursor);
    const page = homeRowItemsPageSchema.parse((await fetchPage(cursor)).body);
    expect(page.rowId).toBe(row.id);
    expect(page.layout).toBe(row.layout);
    expect(page.items.length).toBeLessThanOrEqual(12);
    ids.push(...page.items.map(({ id }) => id));
    expect(ids.length).toBeLessThanOrEqual(48);
    cursor = page.nextCursor;
  }
  expect(new Set(ids).size).toBe(ids.length);
  return ids;
};

/** Expanded signed-in fallback keeps the public selection in a private visit. */
export const verifyPersonalFallbackItems = async (
  testApp: TestApp,
  client: ReturnType<typeof createAuthClient>,
  personalRows: HomeRow[],
  publicRows: HomeRow[],
): Promise<void> => {
  for (const row of personalRows) {
    if (row.layout !== 'standard' && row.layout !== 'vocal-range') continue;
    const publicRow = publicRows.find(({ id }) => id === row.id);
    if (
      publicRow?.layout !== 'standard' &&
      publicRow?.layout !== 'vocal-range'
    ) {
      throw new Error(`Missing public counterpart for ${row.id}`);
    }
    expect(Boolean(row.nextItemsCursor)).toBe(
      Boolean(publicRow.nextItemsCursor),
    );
    const url = (cursor: string) =>
      `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`;
    const personalIds = await completeIds(row, (cursor) =>
      client
        .get(url(cursor))
        .expect('Cache-Control', 'private, no-store')
        .expect(200),
    );
    const publicIds = await completeIds(publicRow, (cursor) =>
      request(testApp.app.getHttpServer()).get(url(cursor)).expect(200),
    );
    expect(personalIds).toEqual(publicIds);
    if (row.nextItemsCursor) {
      await request(testApp.app.getHttpServer())
        .get(url(row.nextItemsCursor))
        .expect(404);
    }
  }
};

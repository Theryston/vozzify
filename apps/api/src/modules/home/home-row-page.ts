import type { HomeRow, Locale } from '@vozzify/contracts';
import { encodeHomeRowItemsCursor } from './home-row-items-cursor.js';
import { HOME_PAGE_SIZE } from './home-rules.js';

export const needsFrozenVisit = (rows: readonly HomeRow[]): boolean =>
  rows.length > HOME_PAGE_SIZE ||
  rows.some(
    (row) =>
      (row.layout === 'standard' || row.layout === 'vocal-range') &&
      row.items.length > 12,
  );

export const pageHomeRowItems = (
  row: HomeRow,
  version: string,
  locale: Locale,
): HomeRow => {
  if (row.layout === 'standard' && row.items.length > 12) {
    return {
      ...row,
      items: row.items.slice(0, 12),
      nextItemsCursor: createCursor(row.id, version, locale),
    };
  }
  if (row.layout === 'vocal-range' && row.items.length > 12) {
    return {
      ...row,
      items: row.items.slice(0, 12),
      nextItemsCursor: createCursor(row.id, version, locale),
    };
  }
  return row;
};

const createCursor = (rowId: string, version: string, locale: Locale) =>
  encodeHomeRowItemsCursor({ version, rowId, position: 12, locale });

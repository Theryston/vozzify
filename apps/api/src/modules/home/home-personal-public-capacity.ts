import type { HomeRow } from '@vozzify/contracts';
import { HOME_TRACK_PAGE_SIZE } from './home-rules.js';

/** Keeps the pre-#506 limit while a personal snapshot is being rebuilt. */
export const capPersonalTrackRows = (rows: HomeRow[]): HomeRow[] =>
  rows.map((row) => {
    if (row.layout === 'standard') {
      return { ...row, items: row.items.slice(0, HOME_TRACK_PAGE_SIZE) };
    }
    if (row.layout === 'vocal-range') {
      return { ...row, items: row.items.slice(0, HOME_TRACK_PAGE_SIZE) };
    }
    return row;
  });

import type { HomeRow } from '@vozzify/contracts';

/** Public expansion changes continuation, not the shared initial contents. */
export const homeInitialRowContents = (row: HomeRow) => {
  if (row.layout !== 'standard' && row.layout !== 'vocal-range') return row;
  const { nextItemsCursor: _cursor, ...contents } = row;
  return contents;
};

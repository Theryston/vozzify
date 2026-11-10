import { createHash } from 'node:crypto';
import type { HomeRow } from '@vozzify/contracts';
import type { ComposableTrack } from './home-composable-track.js';
import { HOME_ROW_RULES, HOME_TRACK_PAGE_SIZE } from './home-rules.js';
import { pickRowItems } from './home-track-row-picker.js';

export const GENRE_ROW_TITLE_KEY = 'home.rows.popularGenre';

export const genreRowId = (genre: string): string =>
  `popular-genre-${createHash('sha256').update(genre).digest('hex').slice(0, 24)}`;

export const isGenreRow = (row: HomeRow): boolean =>
  row.layout === 'standard' && row.title.key === GENRE_ROW_TITLE_KEY;

/** Existing entity layouts retain their position before dynamic genre Rows. */
export const genreRowsLast = (rows: HomeRow[]): HomeRow[] => [
  ...rows.filter((row) => !isGenreRow(row)),
  ...rows.filter(isGenreRow),
];

type GenreCandidate<T> = { id: string; genre?: string; items: readonly T[] };

const creditedArtistKeys = (track: ComposableTrack): readonly string[] =>
  'artistCredit' in track &&
  Array.isArray(track.artistCredit) &&
  track.artistCredit.length === 0
    ? []
    : (track.artistKeys ?? [track.artistKey]);

const provisionalGenreItems = <T extends ComposableTrack>(
  candidate: GenreCandidate<T>,
  used: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
): T[] => {
  const items = pickRowItems({
    candidates: candidate.items,
    rule: HOME_ROW_RULES.standard,
    used,
    reserved,
    bypassArtistCap: false,
    overlapsExisting: false,
    overlapsReserved: false,
    limit: HOME_TRACK_PAGE_SIZE,
    batchOffset: 0,
  });
  const artists = new Set(
    items.flatMap((item) => [...creditedArtistKeys(item)]),
  );
  return items.length === HOME_TRACK_PAGE_SIZE && artists.size >= 6
    ? items
    : [];
};

const meanScore = (items: readonly ComposableTrack[]): number =>
  items.reduce(
    (sum, item) =>
      sum + (item.personalBlendedScore ?? item.collectiveScore ?? 0),
    0,
  ) / items.length;

/** Recomputes both qualification and priority after every accepted genre. */
export const allocateGenreRows = <
  T extends ComposableTrack,
  R extends GenreCandidate<T>,
>(
  candidates: readonly R[],
  used: Set<string>,
  reserved: ReadonlySet<string>,
  availableRows: number,
): (R & { items: T[] })[] => {
  const remaining = [...candidates];
  const rows: (R & { items: T[] })[] = [];
  while (remaining.length > 0 && rows.length < availableRows) {
    const qualified = remaining
      .flatMap((candidate) => {
        const items = provisionalGenreItems(candidate, used, reserved);
        return items.length > 0
          ? [{ candidate, items, score: meanScore(items) }]
          : [];
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          (left.candidate.genre ?? '').localeCompare(
            right.candidate.genre ?? '',
          ),
      );
    const best = qualified[0];
    if (!best) break;
    rows.push({ ...best.candidate, items: best.items });
    for (const item of best.items) used.add(item.id);
    remaining.splice(remaining.indexOf(best.candidate), 1);
  }
  return rows;
};

import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { composeHomeRows } from './home-feed-composer.js';
import { genreArtistKeys } from './home-genre-overlay.js';
import { isGenreRow } from './home-genre-rows.js';
import { spreadPersonalExploration } from './home-personal-exploration.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';
import {
  toComposedHomeRow,
  tracksInHomeRow,
} from './home-public-visit-composer.js';
import { HOME_MAX_ROWS } from './home-rules.js';

const compose = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[],
  pinned: ReadonlySet<string>,
  genreCapacity?: number,
): HomeRow[] => {
  const retained = new Set(rows.map(({ id }) => id));
  const recommendation = composeHomeRows(
    candidates
      .filter(({ id, genre }) => retained.has(id) || genre !== undefined)
      .map((row) => ({
        ...row,
        items: row.items.filter((track) => !pinned.has(track.id)),
      })),
    {
      minimumItems: { standard: 3 },
      minimumItemsByRow: { 'continue-singing': 1, 'sing-again': 1 },
      expandRecommendationRows: true,
      preserveOrder: true,
      genreRowCapacity: genreCapacity,
    },
  ).flatMap((row) => {
    const composed = toComposedHomeRow(row);
    return composed ? [composed] : [];
  });
  const byId = new Map(recommendation.map((row) => [row.id, row]));
  const sourceIds = new Set(candidates.map(({ id }) => id));
  const regular = rows
    .filter((row) => !isGenreRow(row))
    .flatMap((row) => {
      const replacement = byId.get(row.id);
      return replacement ? [replacement] : sourceIds.has(row.id) ? [] : [row];
    });
  return [...regular, ...recommendation.filter(isGenreRow)];
};

const sourcePreview = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[],
): HomeRow[] => {
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  return rows.map((row) => {
    const candidate = byId.get(row.id);
    return candidate ? (toComposedHomeRow(candidate) ?? row) : row;
  });
};

const personalExploration = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[],
  pinned: ReadonlySet<string>,
): HomeRow[] => {
  const pool = candidates.flatMap(({ items }) => items);
  return spreadPersonalExploration({
    rows,
    tasteByTrack: new Map(
      pool.map((track) => [track.id, track.personalTasteScore ?? 0]),
    ),
    sourcePoolsByRow: new Map(
      candidates.map((row) => [
        row.id,
        row.items.filter((track) => !pinned.has(track.id)) as HomeTrack[],
      ]),
    ),
    artistKeysByTrack: new Map(
      pool.map((track) => [track.id, track.artistKeys ?? [track.artistKey]]),
    ),
    reservedTrackIds: new Set(
      rows.filter((row) => row.layout === 'ranked').flatMap(trackIdsOfRow),
    ),
    masteredTrackIds: new Set(),
    seed: candidates.find((row) => row.personalExplorationSeed)
      ?.personalExplorationSeed,
  });
};

const unchangedSelection = (rows: HomeRow[], placed: HomeRow[]): boolean => {
  const algorithmic = placed.filter(({ id }) => !id.startsWith('pin-'));
  return (
    rows.length === algorithmic.length &&
    rows.every(
      (row, index) =>
        row.id === algorithmic[index]?.id &&
        JSON.stringify(trackIdsOfRow(row)) ===
          JSON.stringify(trackIdsOfRow(algorithmic[index] ?? row)),
    )
  );
};

export const composePersonalVisitRows = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[] | undefined,
  pins: readonly OverlayPin[],
): HomeRow[] => {
  const artists = genreArtistKeys(candidates);
  const placed = applyEditorialPins(rows, pins, 'personal', artists);
  if (!candidates || pins.length === 0 || unchangedSelection(rows, placed))
    return placed;
  const excludedRows = new Set<string>();
  for (;;) {
    const preview = applyEditorialPins(
      sourcePreview(rows, candidates).filter(
        (row) => !isGenreRow(row) && !excludedRows.has(row.id),
      ),
      pins,
      'personal',
      artists,
    );
    const pinned = new Set(
      preview
        .filter(({ id }) => id.startsWith('pin-'))
        .flatMap(tracksInHomeRow)
        .map(({ id }) => id),
    );
    const initialRows = preview.filter(({ id }) => !id.startsWith('pin-'));
    const pinCount = preview.length - initialRows.length;
    const recomposed = compose(
      initialRows,
      candidates,
      pinned,
      Math.max(0, HOME_MAX_ROWS - pinCount - initialRows.length),
    );
    const retained = new Set(recomposed.map(({ id }) => id));
    const rejected = initialRows.filter(({ id }) => !retained.has(id));
    if (rejected.length > 0) {
      for (const row of rejected) excludedRows.add(row.id);
      continue;
    }
    return applyEditorialPins(
      personalExploration(recomposed, candidates, pinned),
      pins,
      'personal',
      artists,
    );
  }
};

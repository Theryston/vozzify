import type { HomeRow } from '@vozzify/contracts';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { composeHomeRows } from './home-feed-composer.js';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';
import {
  toComposedHomeRow,
  tracksInHomeRow,
} from './home-public-visit-composer.js';

const compose = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[],
  pinned: ReadonlySet<string>,
): HomeRow[] => {
  const retained = new Set(rows.map(({ id }) => id));
  const recommendation = composeHomeRows(
    candidates
      .filter(({ id }) => retained.has(id))
      .map((row) => ({
        ...row,
        items: row.items.filter((track) => !pinned.has(track.id)),
      })),
    {
      minimumItems: { standard: 3 },
      minimumItemsByRow: { 'continue-singing': 1, 'sing-again': 1 },
      expandRecommendationRows: true,
    },
  ).flatMap((row) => {
    const composed = toComposedHomeRow(row);
    return composed ? [composed] : [];
  });
  const byId = new Map(recommendation.map((row) => [row.id, row]));
  const sourceIds = new Set(candidates.map(({ id }) => id));
  return rows.flatMap((row) => {
    const replacement = byId.get(row.id);
    return replacement ? [replacement] : sourceIds.has(row.id) ? [] : [row];
  });
};

export const composePersonalVisitRows = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[] | undefined,
  pins: readonly OverlayPin[],
): HomeRow[] => {
  if (!candidates || pins.length === 0)
    return applyEditorialPins(rows, pins, 'personal');
  const placed = applyEditorialPins(rows, pins, 'personal');
  const pinned = new Set(
    placed
      .filter(({ id }) => id.startsWith('pin-'))
      .flatMap(tracksInHomeRow)
      .map(({ id }) => id),
  );
  const recomposed = compose(
    placed.filter(({ id }) => !id.startsWith('pin-')),
    candidates,
    pinned,
  );
  return applyEditorialPins(recomposed, pins, 'personal');
};

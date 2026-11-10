import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { allocateGenreRows } from './home-genre-rows.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import {
  toComposedHomeRow,
  tracksInHomeRow,
} from './home-public-visit-composer.js';
import { HOME_MAX_ROWS } from './home-rules.js';

/** Genre initials share the remaining budget before any personal Row expands. */
export const appendPersonalGenreInitials = (options: {
  rows: HomeRow[];
  candidates: HomeCompositionCandidateRow[];
  masteredTrackIds: ReadonlySet<string>;
  reservedTrackIds: ReadonlySet<string>;
  sourcePools: Map<string, readonly HomeTrack[]>;
}): HomeRow[] => {
  const retained = options.rows.slice(0, HOME_MAX_ROWS);
  const used = new Set([
    ...retained.flatMap(trackIdsOfRow),
    ...options.masteredTrackIds,
  ]);
  const selected = allocateGenreRows(
    options.candidates,
    used,
    options.reservedTrackIds,
    HOME_MAX_ROWS - retained.length,
  );
  for (const candidate of options.candidates) {
    const row = toComposedHomeRow(candidate);
    if (row) options.sourcePools.set(candidate.id, tracksInHomeRow(row));
  }
  return [
    ...retained,
    ...selected.flatMap((candidate) => {
      const row = toComposedHomeRow(candidate);
      return row ? [row] : [];
    }),
  ];
};

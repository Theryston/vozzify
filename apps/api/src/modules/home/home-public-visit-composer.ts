import type {
  HomeRow,
  HomeTrack,
  HomeVocalRangeTrack,
} from '@vozzify/contracts';
import {
  type HomeCompositionCandidateRow,
  type HomeCompositionCandidateTrack,
} from './home-composition-candidates.js';
import { composeHomeRows } from './home-feed-composer.js';
import { genreArtistKeys } from './home-genre-overlay.js';
import { genreRowsLast } from './home-genre-rows.js';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';

const trackForComposer = (track: HomeCompositionCandidateTrack): HomeTrack => {
  const {
    artistKey: _artistKey,
    artistKeys: _artistKeys,
    hasCover: _hasCover,
    hasVocalRange: _hasVocalRange,
    isCompleted: _isCompleted,
    sourcePosition: _sourcePosition,
    personalTasteScore: _personalTasteScore,
    collectiveScore: _collectiveScore,
    ...homeTrack
  } = track;
  return homeTrack;
};

export const toComposedHomeRow = (
  row: ReturnType<
    typeof composeHomeRows<
      HomeCompositionCandidateTrack,
      HomeCompositionCandidateRow
    >
  >[number],
): HomeRow | undefined => {
  if (row.layout === 'hero') {
    const [track] = row.items;
    return track
      ? { id: row.id, layout: 'hero', track: trackForComposer(track) }
      : undefined;
  }
  if (!row.title) return undefined;
  if (row.layout === 'vocal-range') {
    const items = row.items.flatMap((item): HomeVocalRangeTrack[] =>
      item.vocalRange === null
        ? []
        : [{ ...trackForComposer(item), vocalRange: item.vocalRange }],
    );
    return items.length > 0
      ? { id: row.id, layout: 'vocal-range', title: row.title, items }
      : undefined;
  }
  const items = row.items.map(trackForComposer);
  return row.layout === 'ranked'
    ? { id: row.id, layout: 'ranked', title: row.title, items }
    : { id: row.id, layout: 'standard', title: row.title, items };
};

export const tracksInHomeRow = (row: HomeRow): HomeTrack[] => {
  if (row.layout === 'hero') return [row.track];
  if (
    row.layout === 'standard' ||
    row.layout === 'vocal-range' ||
    row.layout === 'ranked'
  ) {
    return row.items;
  }
  return [];
};

type CandidateCompositionInput = {
  rows: HomeRow[];
  candidates: HomeCompositionCandidateRow[];
  pins: readonly OverlayPin[];
  audience: 'public' | 'personal';
  expandRecommendationRows?: boolean;
};

const publicRowsFromCandidates = (
  candidates: HomeCompositionCandidateRow[],
  expandRecommendationRows: boolean,
): HomeRow[] =>
  composeHomeRows(candidates, { expandRecommendationRows }).flatMap((row) => {
    const publicRow = toComposedHomeRow(row);
    return publicRow ? [publicRow] : [];
  });

const overlayForCandidates = (
  candidates: HomeCompositionCandidateRow[],
  audience: 'public' | 'personal',
) => {
  const artists = genreArtistKeys(candidates);
  return (rows: HomeRow[], pins: readonly OverlayPin[]) =>
    applyEditorialPins(rows, pins, audience, artists);
};

const rowsWithCompositionCandidates = ({
  rows,
  candidates,
  pins,
  audience,
  expandRecommendationRows = true,
}: CandidateCompositionInput): HomeRow[] => {
  const overlay = overlayForCandidates(candidates, audience);
  const initiallyPlaced = overlay(rows, pins);
  const candidateSourceIds = new Set(candidates.map(({ id }) => id));
  const retainedPinRows = new Set(
    initiallyPlaced
      .filter((row) => row.id.startsWith('pin-'))
      .map(({ id }) => id),
  );
  const activePins = pins.filter((pin) => retainedPinRows.has(`pin-${pin.id}`));
  const retainedPinIds = new Set(
    initiallyPlaced
      .filter((row) => row.id.startsWith('pin-'))
      .flatMap((row) => tracksInHomeRow(row).map(({ id }) => id)),
  );
  const eligibleCandidates = candidates.map((candidate) => ({
    ...candidate,
    items: candidate.items.filter((item) => !retainedPinIds.has(item.id)),
  }));
  const previewRows = publicRowsFromCandidates(
    eligibleCandidates,
    expandRecommendationRows,
  );
  const nonCandidateRows = initiallyPlaced.filter(
    (row) => !row.id.startsWith('pin-') && !candidateSourceIds.has(row.id),
  );
  const capacityRows = overlay(
    genreRowsLast([...previewRows, ...nonCandidateRows]),
    activePins,
  );
  const retainedIds = new Set(
    capacityRows
      .filter((row) => !row.id.startsWith('pin-'))
      .filter(({ id }) => candidateSourceIds.has(id))
      .map(({ id }) => id),
  );
  const retainedNonCandidateIds = new Set(
    capacityRows
      .filter((row) => !row.id.startsWith('pin-'))
      .filter(({ id }) => !candidateSourceIds.has(id))
      .map(({ id }) => id),
  );
  const recomposed = publicRowsFromCandidates(
    eligibleCandidates.filter(({ id }) => retainedIds.has(id)),
    expandRecommendationRows,
  );
  const finalBaseRows = [
    ...recomposed,
    ...nonCandidateRows.filter(({ id }) => retainedNonCandidateIds.has(id)),
  ];
  return overlay(genreRowsLast(finalBaseRows), activePins);
};

/** Rebuilds only visit-retained Rows from their bounded source candidate pools. */
export const composePublicVisitRows = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[] | undefined,
  pins: readonly OverlayPin[],
  audience: 'public' | 'personal' = 'public',
): HomeRow[] =>
  candidates
    ? rowsWithCompositionCandidates({ rows, candidates, pins, audience })
    : applyEditorialPins(rows, pins, audience);

export const composeVisitPhase = (
  rows: HomeRow[],
  candidates: HomeCompositionCandidateRow[],
  pins: readonly OverlayPin[],
  expandRecommendationRows: boolean,
): HomeRow[] =>
  rowsWithCompositionCandidates({
    rows,
    candidates,
    pins,
    audience: 'public',
    expandRecommendationRows,
  });

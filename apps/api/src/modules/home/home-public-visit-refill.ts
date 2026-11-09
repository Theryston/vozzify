import type { HomeRow, Locale } from '@vozzify/contracts';
import {
  type HomeCompositionCandidateRow,
  retainUsefulCompositionCandidates,
  toHomeCompositionCandidateTrack,
} from './home-composition-candidates.js';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';
import {
  composePublicVisitRows,
  composeVisitPhase,
  tracksInHomeRow,
} from './home-public-visit-composer.js';
import { readHomeRowSourcePage } from './home-row-source-pages.js';
import { CANDIDATE_LIMIT } from './home-row-source-ranking.js';
import type { HomeRowSource } from './home-row-sources.js';
import {
  HOME_EXPANDED_ROW_ARTIST_CANDIDATE_LIMIT,
  HOME_MAX_ROWS,
  HOME_TRACK_PAGE_SIZE,
  HOME_TRACK_ROW_MAX_ITEMS,
  MAX_TRACKS_PER_ARTIST_PER_ROW,
} from './home-rules.js';

type RefillVisitInput = {
  rows: HomeRow[];
  candidateRows: HomeCompositionCandidateRow[] | undefined;
  pins: readonly OverlayPin[];
  sources: readonly HomeRowSource[];
  locale: Locale;
};

type RefillContext = RefillVisitInput & {
  candidates: HomeCompositionCandidateRow[];
  placedPinIds: Set<string>;
  initialCapacityFull: boolean;
};

const artistCandidateLimit = (
  candidates: HomeCompositionCandidateRow[],
  index: number,
): number => {
  const earlierRows = candidates.slice(0, index);
  const laterRows = candidates.slice(index + 1);
  const earlierAllowance = earlierRows.reduce(
    (count, candidate) =>
      count +
      (candidate.layout === 'standard' || candidate.layout === 'vocal-range'
        ? HOME_EXPANDED_ROW_ARTIST_CANDIDATE_LIMIT
        : candidate.layout === 'hero'
          ? 1
          : 0),
    0,
  );
  const laterAllowance = laterRows.reduce(
    (count, candidate) =>
      count +
      (candidate.layout === 'standard' || candidate.layout === 'vocal-range'
        ? MAX_TRACKS_PER_ARTIST_PER_ROW
        : candidate.layout === 'hero'
          ? 1
          : 0),
    0,
  );
  return (
    HOME_EXPANDED_ROW_ARTIST_CANDIDATE_LIMIT + earlierAllowance + laterAllowance
  );
};

const visibleItemCount = (rows: HomeRow[], rowId: string): number => {
  const row = rows.find(({ id }) => id === rowId);
  return row?.layout === 'standard' || row?.layout === 'vocal-range'
    ? row.items.length
    : 0;
};

const stopRefill = (
  context: RefillContext,
  candidate: HomeCompositionCandidateRow,
  target: number,
  rows: HomeRow[],
): boolean => {
  const visible = rows.some(({ id }) => id === candidate.id);
  return (
    visibleItemCount(rows, candidate.id) >= target ||
    (!visible && context.initialCapacityFull)
  );
};

const loadCandidatePage = async (
  context: RefillContext,
  candidate: HomeCompositionCandidateRow,
  index: number,
): Promise<void> => {
  const source = context.sources.find(({ id }) => id === candidate.id);
  if (!source || candidate.nextOffset === undefined) return;
  const page = await readHomeRowSourcePage(
    source,
    context.locale,
    candidate.nextOffset,
  );
  const knownIds = new Set(candidate.items.map(({ id }) => id));
  const pageOffset = candidate.nextOffset;
  const additions = page.items.flatMap((item, index) => {
    if (knownIds.has(item.id) || context.placedPinIds.has(item.id)) return [];
    return [
      {
        ...toHomeCompositionCandidateTrack(item),
        sourcePosition: pageOffset + index,
      },
    ];
  });
  candidate.items = retainUsefulCompositionCandidates(
    [...candidate.items, ...additions].sort(
      (left, right) => (left.sourcePosition ?? 0) - (right.sourcePosition ?? 0),
    ),
    context.placedPinIds,
    artistCandidateLimit(context.candidates, index),
  );
  candidate.nextOffset += source.candidatePageSize ?? CANDIDATE_LIMIT;
  candidate.hasMore = page.hasMore;
};

const refillCandidateRow = async (
  context: RefillContext,
  index: number,
  target: number,
  expand: boolean,
): Promise<HomeRow[]> => {
  const candidate = context.candidates[index];
  if (!candidate) return [];
  if (!context.sources.some(({ id }) => id === candidate.id)) {
    return composeVisitPhase(
      context.rows,
      context.candidates,
      context.pins,
      expand,
    );
  }
  const limit = artistCandidateLimit(context.candidates, index);
  candidate.items = retainUsefulCompositionCandidates(
    candidate.items,
    context.placedPinIds,
    limit,
  );
  let composed = composeVisitPhase(
    context.rows,
    context.candidates,
    context.pins,
    expand,
  );
  while (
    candidate.hasMore &&
    candidate.nextOffset !== undefined &&
    !stopRefill(context, candidate, target, composed)
  ) {
    await loadCandidatePage(context, candidate, index);
    composed = composeVisitPhase(
      context.rows,
      context.candidates,
      context.pins,
      expand,
    );
  }
  return composed;
};

const placedPinIds = (
  rows: HomeRow[],
  pins: readonly OverlayPin[],
): Set<string> =>
  new Set(
    applyEditorialPins(rows, pins)
      .filter(({ id }) => id.startsWith('pin-'))
      .flatMap(tracksInHomeRow)
      .map(({ id }) => id),
  );

/** Refills bounded source pages only while selecting a new public visit. */
export const composePublicVisitRowsWithRefill = async (
  input: RefillVisitInput,
): Promise<HomeRow[]> => {
  const { rows, candidateRows, pins, sources } = input;
  if (!candidateRows?.length || !sources.length) {
    return composePublicVisitRows(rows, candidateRows, pins);
  }
  const context: RefillContext = {
    ...input,
    candidates: candidateRows.map((candidate) => ({ ...candidate })),
    placedPinIds: placedPinIds(rows, pins),
    initialCapacityFull: applyEditorialPins(rows, pins).length >= HOME_MAX_ROWS,
  };
  let composed = composeVisitPhase(rows, context.candidates, pins, false);
  for (const [index, candidate] of context.candidates.entries()) {
    if (candidate.layout === 'standard' || candidate.layout === 'vocal-range') {
      composed = await refillCandidateRow(
        context,
        index,
        HOME_TRACK_PAGE_SIZE,
        false,
      );
    }
  }
  composed = composeVisitPhase(rows, context.candidates, pins, true);
  for (const [index, candidate] of context.candidates.entries()) {
    if (candidate.layout === 'standard' || candidate.layout === 'vocal-range') {
      composed = await refillCandidateRow(
        context,
        index,
        HOME_TRACK_ROW_MAX_ITEMS,
        true,
      );
    }
  }
  return composed;
};

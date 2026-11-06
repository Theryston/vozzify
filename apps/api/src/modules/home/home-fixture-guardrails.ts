import type { ComposableTrack } from './home-feed-composer.js';

export type HomeFixtureGuardrails = {
  candidateCoverage: number;
  duplicateExposure: number;
  maximumArtistShare: number;
  discardedRows: number;
  selectionLatencyMs: number;
};

/** Summarizes bounded composer fixtures without affecting feed generation. */
export const homeFixtureGuardrails = <T extends ComposableTrack>(options: {
  candidates: readonly { items: readonly T[] }[];
  selectedRows: readonly { items: readonly T[] }[];
  selectionLatencyMs: number;
}): HomeFixtureGuardrails => {
  const candidates = new Set(
    options.candidates.flatMap((row) =>
      row.items.filter((track) => track.isCompleted).map((track) => track.id),
    ),
  );
  const selected = options.selectedRows.flatMap((row) => row.items);
  const distinctSelected = new Set(selected.map((track) => track.id));
  const artistCounts = new Map<string, number>();
  for (const track of selected) {
    artistCounts.set(
      track.artistKey,
      (artistCounts.get(track.artistKey) ?? 0) + 1,
    );
  }
  const maximumArtistCount = Math.max(0, ...artistCounts.values());
  return {
    candidateCoverage:
      candidates.size === 0 ? 0 : distinctSelected.size / candidates.size,
    duplicateExposure:
      selected.length === 0
        ? 0
        : (selected.length - distinctSelected.size) / selected.length,
    maximumArtistShare:
      selected.length === 0 ? 0 : maximumArtistCount / selected.length,
    discardedRows: options.candidates.length - options.selectedRows.length,
    selectionLatencyMs: options.selectionLatencyMs,
  };
};

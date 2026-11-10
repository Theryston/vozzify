import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import { personalTrackCandidate } from './home-personal-track-candidate.js';
import {
  HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS,
  HOME_TRACK_PAGE_SIZE,
} from './home-rules.js';

type CandidateOptions = {
  rows: HomeRow[];
  sourcePoolsByRow: Record<string, HomeTrack[]>;
  artistKeysByTrack: ReadonlyMap<string, string[]>;
  mastered: ReadonlySet<string>;
  tasteByTrack?: ReadonlyMap<string, number>;
  explorationSeed?: string;
};

/** Retain private source order so live Pins can release displaced allocations. */
export const personalCompositionCandidates = (
  options: CandidateOptions,
): HomeCompositionCandidateRow[] => {
  const reserved = new Set(
    options.rows.flatMap((row) => {
      if (row.layout === 'ranked') return trackIdsOfRow(row);
      return row.id === 'continue-singing' || row.id === 'sing-again'
        ? trackIdsOfRow(row).slice(0, HOME_TRACK_PAGE_SIZE)
        : [];
    }),
  );
  return options.rows.flatMap((row): HomeCompositionCandidateRow[] => {
    if (
      row.layout !== 'standard' &&
      row.layout !== 'vocal-range' &&
      row.layout !== 'ranked' &&
      row.layout !== 'hero'
    )
      return [];
    const initial = row.layout === 'hero' ? [row.track] : row.items;
    const exceptional =
      row.layout === 'ranked' ||
      row.layout === 'hero' ||
      row.id === 'continue-singing' ||
      row.id === 'sing-again';
    const tracks = [
      ...new Map(
        [...initial, ...(options.sourcePoolsByRow[row.id] ?? [])].map(
          (track) => [track.id, track],
        ),
      ).values(),
    ].filter(
      (track) =>
        exceptional ||
        (!options.mastered.has(track.id) && !reserved.has(track.id)),
    );
    return [
      {
        id: row.id,
        layout: row.layout,
        ...(options.explorationSeed
          ? { personalExplorationSeed: options.explorationSeed }
          : {}),
        ...(row.layout === 'hero' ? {} : { title: row.title }),
        items: tracks
          .slice(0, HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS)
          .map((track) =>
            personalTrackCandidate(
              track,
              options.artistKeysByTrack,
              options.tasteByTrack?.get(track.id),
            ),
          ),
      },
    ];
  });
};

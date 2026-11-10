import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { isGenreRow } from './home-genre-rows.js';
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

const reservedPersonalTracks = (options: CandidateOptions) => {
  return new Set(
    options.rows.flatMap((row) => {
      if (row.layout === 'ranked') return trackIdsOfRow(row);
      return row.id === 'continue-singing' || row.id === 'sing-again'
        ? trackIdsOfRow(row).slice(0, HOME_TRACK_PAGE_SIZE)
        : [];
    }),
  );
};

/** Retain private source order so live Pins can release displaced allocations. */
export const personalCompositionCandidates = (
  options: CandidateOptions,
): HomeCompositionCandidateRow[] => {
  const reserved = reservedPersonalTracks(options);
  return options.rows
    .filter((row) => !isGenreRow(row))
    .flatMap((row): HomeCompositionCandidateRow[] => {
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
      const source = options.sourcePoolsByRow[row.id] ?? [];
      const ordered =
        row.id === 'continue-singing' || row.id === 'sing-again'
          ? [...source, ...initial]
          : [...initial, ...source];
      const tracks = [
        ...new Map(ordered.map((track) => [track.id, track])).values(),
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

import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import { HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS } from './home-rules.js';

type CandidateOptions = {
  rows: HomeRow[];
  sourcePoolsByRow: Record<string, HomeTrack[]>;
  artistKeysByTrack: ReadonlyMap<string, string[]>;
  mastered: ReadonlySet<string>;
};

/** Retain private source order so live Pins can release displaced allocations. */
export const personalCompositionCandidates = (
  options: CandidateOptions,
): HomeCompositionCandidateRow[] => {
  const reserved = new Set(
    options.rows
      .filter((row) =>
        ['continue-singing', 'sing-again', 'top-10-week'].includes(row.id),
      )
      .flatMap(trackIdsOfRow),
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
        ...(row.layout === 'hero' ? {} : { title: row.title }),
        items: tracks
          .slice(0, HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS)
          .map((track) => ({
            ...track,
            artistKey: options.artistKeysByTrack.get(track.id)?.[0] ?? track.id,
            artistKeys:
              options.artistKeysByTrack.get(track.id) ??
              homeArtistKeys(track.artistCredit, track.id),
            hasCover: track.coverUrl !== null,
            hasVocalRange: track.vocalRange !== null,
            isCompleted: true,
          })),
      },
    ];
  });
};

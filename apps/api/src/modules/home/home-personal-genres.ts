import type { TrackVocalRange } from '@vozzify/contracts';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { type PersonalTaste, personalScore } from './home-personal.js';
import { blendDiscoveryCandidates } from './home-personal-blend.js';

type GenreOptions = {
  candidates: HomeCompositionCandidateRow[];
  taste: PersonalTaste;
  lambda: number;
  userRange: TrackVocalRange | null;
  voiceConfidence: number;
  mastered: ReadonlySet<string>;
};

const genrePool = (candidates: HomeCompositionCandidateRow[]) => {
  const tracks = new Map(
    candidates.flatMap((row) =>
      row.items.map((track) => [track.id, track] as const),
    ),
  );
  const genres = new Map<string, Set<string>>();
  for (const row of candidates) {
    if (row.genre === undefined) continue;
    for (const track of row.items) {
      const membership = genres.get(track.id) ?? new Set<string>();
      membership.add(row.genre);
      genres.set(track.id, membership);
    }
  }
  return { tracks, genres };
};

/** Rank the shared collective pool, without another catalog score aggregate. */
export const personalGenreCandidates = (
  options: GenreOptions,
): (HomeCompositionCandidateRow & { genre: string; layout: 'standard' })[] => {
  const { tracks, genres } = genrePool(options.candidates);
  const discovery = new Map(
    [...tracks].map(([id, track]) => [
      id,
      {
        trendingScore: track.collectiveScore ?? 0,
        artistKey: track.artistKey,
        artistKeys: track.artistKeys,
        genres: [...(genres.get(id) ?? [])],
      },
    ]),
  );
  const scores = new Map(
    blendDiscoveryCandidates({
      tracks: [...tracks.values()],
      discovery,
      taste: options.taste,
      lambda: options.lambda,
      userRange: options.userRange,
      voiceConfidence: options.voiceConfidence,
    }).map((candidate) => [candidate.track.id, candidate]),
  );
  return options.candidates.flatMap((row) =>
    row.genre === undefined
      ? []
      : [
          {
            ...row,
            genre: row.genre,
            layout: 'standard' as const,
            items: row.items
              .filter(
                (track) =>
                  !options.mastered.has(track.id) &&
                  track.isCompleted &&
                  (track.collectiveScore ?? 0) > 0,
              )
              .map((track) => ({
                ...track,
                personalBlendedScore: scores.get(track.id)?.blended ?? 0,
                personalTasteScore: personalScore(
                  [...(genres.get(track.id) ?? [])],
                  track.artistKey,
                  options.taste,
                ),
              }))
              .sort(
                (left, right) =>
                  right.personalBlendedScore - left.personalBlendedScore ||
                  left.id.localeCompare(right.id),
              ),
          },
        ],
  );
};

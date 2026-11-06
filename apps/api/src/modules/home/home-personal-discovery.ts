import type {
  HomeCarouselRow,
  HomeHero,
  HomeRow,
  HomeTrack,
  TrackVocalRange,
} from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { catalogRecommendationRow } from './home-catalog-recommendation.js';
import { composeHomeRows } from './home-feed-composer.js';
import type { PersonalTaste } from './home-personal.js';
import {
  blendDiscoveryCandidates,
  byBlendedDesc,
  type DiscoveryCandidate,
  type DiscoveryTrack,
} from './home-personal-blend.js';
import { personalTrackPool } from './home-personal-voice.js';
import { PERSONAL_DISCOVERY_ROW_MIN_ITEMS } from './home-rules.js';

/** Ranks the public Track pool by its blended score and drops mastered songs. */
export const blendedDiscoveryPool = (options: {
  publicRows: HomeRow[];
  catalogTracks?: HomeTrack[];
  discovery: ReadonlyMap<string, DiscoveryTrack>;
  taste: PersonalTaste;
  lambda: number;
  masteredTrackIds: ReadonlySet<string>;
  userRange?: TrackVocalRange | null;
  voiceConfidence?: number;
}): DiscoveryCandidate[] => {
  const {
    publicRows,
    discovery,
    taste,
    lambda,
    masteredTrackIds,
    userRange,
    voiceConfidence,
  } = options;
  return blendDiscoveryCandidates({
    tracks: personalTrackPool(publicRows),
    catalogTracks: options.catalogTracks,
    discovery,
    taste,
    lambda,
    userRange,
    voiceConfidence,
  })
    .filter((candidate) => !masteredTrackIds.has(candidate.track.id))
    .sort(byBlendedDesc);
};

const discoveryHeroRow = (
  sorted: DiscoveryCandidate[],
): HomeHero | undefined => {
  const heroTrack = sorted.find((candidate) => candidate.hasCover)?.track;
  return heroTrack
    ? { id: 'hero', layout: 'hero', track: heroTrack }
    : undefined;
};

const discoveryItems = (
  row: Extract<HomeRow, { layout: 'standard' }>,
  options: {
    blended: Map<string, DiscoveryCandidate>;
    replacementIds: ReadonlySet<string>;
    heroId: string | undefined;
    masteredTrackIds: ReadonlySet<string>;
    alreadyUsedTrackIds: ReadonlySet<string>;
    reservedTrackIds: ReadonlySet<string>;
  },
) =>
  [...row.items.map((track) => track.id), ...options.replacementIds]
    .map((trackId) => options.blended.get(trackId))
    .filter(
      (candidate): candidate is DiscoveryCandidate =>
        candidate !== undefined &&
        candidate.track.id !== options.heroId &&
        !options.alreadyUsedTrackIds.has(candidate.track.id) &&
        !options.reservedTrackIds.has(candidate.track.id) &&
        !options.masteredTrackIds.has(candidate.track.id),
    )
    .sort(byBlendedDesc)
    .map((candidate) => ({
      id: candidate.track.id,
      artistKey: candidate.artistKey,
      artistKeys:
        candidate.artistKeys ??
        homeArtistKeys(candidate.track.artistCredit, candidate.track.id),
      hasCover: candidate.hasCover,
      isCompleted: true,
    }));

const discoveryStandardRows = (options: {
  publicRows: HomeRow[];
  candidatesByRow?: Record<string, HomeTrack[]>;
  blended: Map<string, DiscoveryCandidate>;
  sorted: DiscoveryCandidate[];
  masteredTrackIds: ReadonlySet<string>;
  alreadyUsedTrackIds: ReadonlySet<string>;
  reservedTrackIds: ReadonlySet<string>;
}): HomeCarouselRow[] => {
  const {
    publicRows,
    candidatesByRow = {},
    sorted,
    blended,
    masteredTrackIds,
    alreadyUsedTrackIds,
    reservedTrackIds,
  } = options;
  const usedTrackIds = new Set(alreadyUsedTrackIds);
  const heroId = sorted.find((candidate) => candidate.hasCover)?.track.id;
  const rows: HomeCarouselRow[] = [];
  for (const row of publicRows) {
    if (row.layout !== 'standard') {
      continue;
    }
    const [composed] = composeHomeRows(
      [
        {
          id: row.id,
          layout: 'standard' as const,
          title: row.title,
          items: discoveryItems(row, {
            blended,
            replacementIds: new Set(
              (candidatesByRow[row.id] ?? []).map((track) => track.id),
            ),
            heroId,
            masteredTrackIds,
            alreadyUsedTrackIds: usedTrackIds,
            reservedTrackIds,
          }),
        },
      ],
      {
        minimumItems: { standard: PERSONAL_DISCOVERY_ROW_MIN_ITEMS },
      },
    );
    if (!composed?.title) {
      continue;
    }
    const itemsById = new Map(
      [...row.items, ...(candidatesByRow[row.id] ?? [])].map((track) => [
        track.id,
        track,
      ]),
    );
    rows.push({
      id: composed.id,
      layout: 'standard',
      title: composed.title,
      items: composed.items.map((item) => {
        const track: HomeTrack | undefined = itemsById.get(item.id);
        if (!track) {
          throw new Error(`Discovery row lost Track ${item.id}`);
        }
        return track;
      }),
    });
    for (const item of composed.items) usedTrackIds.add(item.id);
  }
  return rows;
};

/** Builds the blended hero and standard rows after personal rows took their Tracks. */
export const buildPersonalDiscoveryRows = (options: {
  publicRows: HomeRow[];
  candidatesByRow?: Record<string, HomeTrack[]>;
  catalogCandidates?: DiscoveryCandidate[];
  sorted: DiscoveryCandidate[];
  masteredTrackIds: ReadonlySet<string>;
  alreadyUsedTrackIds: ReadonlySet<string>;
  reservedTrackIds?: ReadonlySet<string>;
}): HomeRow[] => {
  const {
    publicRows,
    candidatesByRow,
    catalogCandidates = [],
    sorted,
    masteredTrackIds,
    alreadyUsedTrackIds,
    reservedTrackIds = new Set<string>(),
  } = options;
  const eligible = sorted.filter(
    (candidate) =>
      !alreadyUsedTrackIds.has(candidate.track.id) ||
      reservedTrackIds.has(candidate.track.id),
  );
  const blended = new Map(
    eligible.map((candidate) => [candidate.track.id, candidate]),
  );
  const heroEligible = sorted.filter(
    (candidate) =>
      !masteredTrackIds.has(candidate.track.id) &&
      (!alreadyUsedTrackIds.has(candidate.track.id) ||
        reservedTrackIds.has(candidate.track.id)),
  );
  const hero = discoveryHeroRow(heroEligible);
  const standardRows = discoveryStandardRows({
    publicRows,
    candidatesByRow,
    blended,
    sorted: eligible,
    masteredTrackIds,
    alreadyUsedTrackIds,
    reservedTrackIds,
  });
  const allocated = new Set([
    ...alreadyUsedTrackIds,
    ...standardRows.flatMap((row) => row.items.map((track) => track.id)),
    ...(hero ? [hero.track.id] : []),
  ]);
  const catalogRow = catalogRecommendationRow(
    catalogCandidates,
    allocated,
    standardRows,
    blended,
  );
  return [
    ...(hero ? [hero] : []),
    ...standardRows,
    ...(catalogRow ? [catalogRow] : []),
  ];
};

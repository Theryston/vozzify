import type {
  HomeCarouselRow,
  HomeHero,
  HomeRow,
  HomeTrack,
  TrackVocalRange,
} from '@vozzify/contracts';
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
  discovery: ReadonlyMap<string, DiscoveryTrack>;
  taste: PersonalTaste;
  lambda: number;
  masteredTrackIds: ReadonlySet<string>;
  userRange?: TrackVocalRange | null;
}): DiscoveryCandidate[] => {
  const { publicRows, discovery, taste, lambda, masteredTrackIds, userRange } =
    options;
  return blendDiscoveryCandidates({
    tracks: personalTrackPool(publicRows),
    discovery,
    taste,
    lambda,
    userRange,
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
    heroId: string | undefined;
    masteredTrackIds: ReadonlySet<string>;
    alreadyUsedTrackIds: ReadonlySet<string>;
    reservedTrackIds: ReadonlySet<string>;
  },
) =>
  row.items
    .map((track) => options.blended.get(track.id))
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
      hasCover: candidate.hasCover,
      isCompleted: true,
    }));

const discoveryStandardRows = (options: {
  publicRows: HomeRow[];
  sorted: DiscoveryCandidate[];
  masteredTrackIds: ReadonlySet<string>;
  alreadyUsedTrackIds: ReadonlySet<string>;
  reservedTrackIds: ReadonlySet<string>;
}): HomeCarouselRow[] => {
  const {
    publicRows,
    sorted,
    masteredTrackIds,
    alreadyUsedTrackIds,
    reservedTrackIds,
  } = options;
  const heroId = sorted.find((candidate) => candidate.hasCover)?.track.id;
  const blended = new Map(
    sorted.map((candidate) => [candidate.track.id, candidate]),
  );
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
            heroId,
            masteredTrackIds,
            alreadyUsedTrackIds,
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
    const itemsById = new Map(row.items.map((track) => [track.id, track]));
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
  }
  return rows;
};

/** Builds the blended hero and standard rows after personal rows took their Tracks. */
export const buildPersonalDiscoveryRows = (options: {
  publicRows: HomeRow[];
  sorted: DiscoveryCandidate[];
  masteredTrackIds: ReadonlySet<string>;
  alreadyUsedTrackIds: ReadonlySet<string>;
  reservedTrackIds?: ReadonlySet<string>;
}): HomeRow[] => {
  const {
    publicRows,
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
  const hero = discoveryHeroRow(eligible);
  return [
    ...(hero ? [hero] : []),
    ...discoveryStandardRows({
      publicRows,
      sorted: eligible,
      masteredTrackIds,
      alreadyUsedTrackIds,
      reservedTrackIds,
    }),
  ];
};

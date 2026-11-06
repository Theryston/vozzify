import type { HomeCarouselRow } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { composeHomeRows } from './home-feed-composer.js';
import {
  byBlendedDesc,
  type DiscoveryCandidate,
} from './home-personal-blend.js';
import { PERSONAL_DISCOVERY_ROW_MIN_ITEMS } from './home-rules.js';
import { progressiveExposureFactor } from './home-stage2-scoring.js';

const catalogArtistExposures = (
  previousRows: HomeCarouselRow[],
  blended: Map<string, DiscoveryCandidate>,
): Map<string, number> => {
  const artistExposures = new Map<string, number>();
  for (const row of previousRows) {
    for (const track of row.items) {
      const keys =
        blended.get(track.id)?.artistKeys ??
        homeArtistKeys(track.artistCredit, track.id);
      for (const artistKey of keys) {
        artistExposures.set(
          artistKey,
          (artistExposures.get(artistKey) ?? 0) + 1,
        );
      }
    }
  }
  return artistExposures;
};

const rankUnusedCandidates = (
  candidates: DiscoveryCandidate[],
  used: ReadonlySet<string>,
  artistExposures: ReadonlyMap<string, number>,
): DiscoveryCandidate[] => {
  return candidates
    .filter((candidate) => !used.has(candidate.track.id))
    .map((candidate) => {
      const keys =
        candidate.artistKeys ??
        homeArtistKeys(candidate.track.artistCredit, candidate.track.id);
      const exposure =
        keys.reduce(
          (sum, key) =>
            sum + progressiveExposureFactor(artistExposures.get(key) ?? 0),
          0,
        ) / keys.length;
      return { ...candidate, blended: candidate.blended * exposure };
    })
    .sort(byBlendedDesc);
};

const pickCatalogExploration = (
  unused: DiscoveryCandidate[],
): DiscoveryCandidate[] => {
  const nearby = unused.filter((candidate) => candidate.personal > 0);
  const surprising = unused.filter((candidate) => candidate.personal === 0);
  const slotCount = Math.min(
    Math.max(1, Math.floor(Math.min(unused.length, 12) * 0.2)),
    unused.length,
  );
  const startSurprising = (unused[0]?.track.id.charCodeAt(0) ?? 0) % 2 === 1;
  const exploration = Array.from({ length: slotCount }, (_, index) => {
    const source = (index % 2 === 0) === startSurprising ? surprising : nearby;
    const candidate = source.shift();
    return (
      candidate ?? (source === surprising ? nearby.shift() : surprising.shift())
    );
  }).filter(
    (candidate): candidate is DiscoveryCandidate => candidate !== undefined,
  );
  return exploration;
};

const orderCatalogCandidates = (
  unused: DiscoveryCandidate[],
  exploration: DiscoveryCandidate[],
): DiscoveryCandidate[] => {
  const explorationIds = new Set(
    exploration.map((candidate) => candidate.track.id),
  );
  const regular = unused
    .filter((candidate) => !explorationIds.has(candidate.track.id))
    .slice(0, 12 - exploration.length);
  const ordered = [...regular];
  let position = 4;
  for (const candidate of exploration) {
    ordered.splice(Math.min(position, ordered.length), 0, candidate);
    position += 5;
  }
  return ordered;
};

const composeCatalogRecommendation = (
  ordered: DiscoveryCandidate[],
): HomeCarouselRow | undefined => {
  const [row] = composeHomeRows(
    [
      {
        id: 'recommended-for-you',
        layout: 'standard',
        title: { key: 'home.rows.forYou', params: {} },
        items: ordered.map((candidate) => ({
          id: candidate.track.id,
          artistKey: candidate.artistKey,
          artistKeys:
            candidate.artistKeys ??
            homeArtistKeys(candidate.track.artistCredit, candidate.track.id),
          hasCover: candidate.hasCover,
          isCompleted: true,
          track: candidate.track,
          score: candidate.blended,
        })),
      },
    ],
    { minimumItems: { standard: PERSONAL_DISCOVERY_ROW_MIN_ITEMS } },
  );
  return row?.title
    ? {
        id: row.id,
        layout: 'standard',
        title: row.title,
        items: row.items.map((candidate) => candidate.track),
      }
    : undefined;
};

export const catalogRecommendationRow = (
  candidates: DiscoveryCandidate[],
  used: ReadonlySet<string>,
  previousRows: HomeCarouselRow[],
  blended: Map<string, DiscoveryCandidate>,
): HomeCarouselRow | undefined => {
  const artistExposures = catalogArtistExposures(previousRows, blended);
  const unused = rankUnusedCandidates(candidates, used, artistExposures);
  const exploration = pickCatalogExploration(unused);
  return composeCatalogRecommendation(
    orderCatalogCandidates(unused, exploration),
  );
};

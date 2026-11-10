import type {
  HomeRow,
  HomeTrack,
  HomeVocalRangeTrack,
} from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import {
  composeHomeRows,
  progressiveOrderItems,
} from './home-feed-composer.js';
import { expandPersonalRows } from './home-personal-expansion.js';
import { spreadPersonalExploration } from './home-personal-exploration.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import type { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { personalTrackCandidate } from './home-personal-track-candidate.js';
import { HOME_MAX_ROWS } from './home-rules.js';

type PersonalComposition = {
  hero: HomeRow | undefined;
  dailyTarget: HomeRow;
  resumes: HomeRow[];
  socialRows: HomeRow[];
  publicRows: HomeRow[];
  recommendations: HomeRow[];
  masteredTrackIds?: ReadonlySet<string>;
  artistKeysByTrack?: ReadonlyMap<string, string[]>;
  tasteByTrack?: ReadonlyMap<string, number>;
  explorationPoolsByRow?: ReadonlyMap<string, readonly HomeTrack[]>;
  explorationSeed?: string;
  expandRecommendationRows?: boolean;
};

const progressiveRows = (
  rows: HomeRow[],
  artistKeysByTrack: ReadonlyMap<string, string[]>,
): HomeRow[] => {
  const exposures = new Map<string, number>();
  const addExposures = (id: string, keys: readonly string[]) => {
    if (id === 'continue-singing' || id === 'sing-again') return;
    for (const key of keys) exposures.set(key, (exposures.get(key) ?? 0) + 1);
  };
  const keysOf = (track: HomeTrack) =>
    artistKeysByTrack.get(track.id) ??
    homeArtistKeys(track.artistCredit, track.id);
  const apply = (row: HomeRow): HomeRow => {
    if (row.layout === 'hero') addExposures(row.id, keysOf(row.track));
    if (row.layout === 'standard') {
      const keepsOrder = ['continue-singing', 'sing-again'].includes(row.id);
      const items = keepsOrder
        ? row.items
        : progressiveOrderItems(row.items, keysOf, exposures);
      addExposures(
        row.id,
        items.flatMap((item) => keysOf(item)),
      );
      return { ...row, items };
    }
    if (row.layout === 'vocal-range') {
      const items = progressiveOrderItems(row.items, keysOf, exposures);
      addExposures(
        row.id,
        items.flatMap((item) => keysOf(item)),
      );
      return { ...row, items };
    }
    if (row.layout === 'ranked') {
      addExposures(
        row.id,
        row.items.flatMap((item) => keysOf(item)),
      );
    }
    return row;
  };
  return rows.map(apply);
};

const publicCategory = (row: HomeRow): boolean =>
  row.layout === 'albums' ||
  row.layout === 'artists' ||
  row.layout === 'genres' ||
  row.layout === 'ranked';

const fallbackVoiceRows = ({
  publicRows,
  resumes,
  recommendations,
  masteredTrackIds,
  sourcePoolsByRow,
  artistKeysByTrack,
}: {
  publicRows: HomeRow[];
  resumes: HomeRow[];
  recommendations: HomeRow[];
  masteredTrackIds: ReadonlySet<string>;
  sourcePoolsByRow: ReadonlyMap<string, readonly HomeTrack[]>;
  artistKeysByTrack: ReadonlyMap<string, string[]>;
}): HomeRow[] => {
  if (recommendations.some((row) => row.layout === 'vocal-range')) return [];
  const usedTrackIds = new Set([
    ...resumes.flatMap(trackIdsOfRow),
    ...recommendations.flatMap(trackIdsOfRow),
  ]);
  return publicRows.flatMap((row) => {
    if (row.layout !== 'vocal-range') return [];
    const candidates = [
      ...new Map(
        [...row.items, ...(sourcePoolsByRow.get(row.id) ?? [])].map((track) => [
          track.id,
          track,
        ]),
      ).values(),
    ];
    const items = candidates.filter(
      (item): item is HomeVocalRangeTrack =>
        item.vocalRange !== null &&
        !usedTrackIds.has(item.id) &&
        !masteredTrackIds.has(item.id),
    );
    const [initial] = composeHomeRows([
      {
        id: row.id,
        layout: 'vocal-range' as const,
        items: items.map((track) => ({
          ...personalTrackCandidate(track, artistKeysByTrack),
          track,
        })),
      },
    ]);
    return initial
      ? [{ ...row, items: initial.items.map(({ track }) => track) }]
      : [];
  });
};

const qualityCategory = (row: HomeRow): boolean =>
  (row.layout === 'albums' ||
    row.layout === 'artists' ||
    row.layout === 'people') &&
  row.items.length >= 3;

const keepQualityCategoryEarly = (
  remainder: HomeRow[],
  rowsWithQuality: HomeRow[],
  lastFirstSixIndex: number,
): HomeRow[] => {
  const category = rowsWithQuality.find(qualityCategory);
  const index = category ? remainder.indexOf(category) : -1;
  if (!category || index <= lastFirstSixIndex) return remainder;
  return [
    ...remainder.slice(0, lastFirstSixIndex),
    category,
    ...remainder.slice(lastFirstSixIndex).filter((row) => row !== category),
  ];
};

/** Places the Daily target after the final hero and restores public categories. */
export const composePersonalHomeRows = ({
  hero,
  dailyTarget,
  resumes,
  socialRows,
  publicRows,
  recommendations,
  masteredTrackIds = new Set<string>(),
  artistKeysByTrack = new Map<string, string[]>(),
  tasteByTrack = new Map<string, number>(),
  explorationPoolsByRow = new Map<string, readonly HomeTrack[]>(),
  explorationSeed,
  expandRecommendationRows = false,
}: PersonalComposition): HomeRow[] => {
  const sourcePools = new Map(explorationPoolsByRow);
  for (const row of publicRows)
    if (row.layout === 'vocal-range' && !sourcePools.has(row.id))
      sourcePools.set(row.id, row.items);
  const fallbackVoice = fallbackVoiceRows({
    publicRows,
    resumes,
    recommendations,
    masteredTrackIds,
    sourcePoolsByRow: sourcePools,
    artistKeysByTrack,
  });
  const categories = [
    ...publicRows.filter(publicCategory),
    ...fallbackVoice.map((row) =>
      expandRecommendationRows && row.layout === 'vocal-range'
        ? { ...row, items: row.items.slice(0, 12) }
        : row,
    ),
  ];
  const remainder = [
    ...socialRows,
    ...categories,
    ...recommendations.filter((row) => row.layout !== 'hero'),
  ];
  const prefixLength = (hero ? 1 : 0) + 1 + resumes.length;
  const prioritized = keepQualityCategoryEarly(
    remainder,
    [...socialRows, ...categories],
    Math.max(0, 5 - prefixLength),
  );
  const initial = progressiveRows(
    [...(hero ? [hero] : []), dailyTarget, ...resumes, ...prioritized],
    artistKeysByTrack,
  );
  const expanded = expandRecommendationRows
    ? expandPersonalRows({
        rows: initial.slice(0, HOME_MAX_ROWS),
        sourcePoolsByRow: sourcePools,
        artistKeysByTrack,
        masteredTrackIds,
        reservedTrackIds: reservedChartTrackIds(publicRows),
      })
    : initial;
  return spreadPersonalExploration({
    rows: expanded,
    tasteByTrack,
    sourcePoolsByRow: sourcePools,
    masteredTrackIds,
    reservedTrackIds: reservedChartTrackIds(publicRows),
    artistKeysByTrack,
    seed: explorationSeed,
  });
};

export const reservedChartTrackIds = (rows: HomeRow[]): Set<string> =>
  new Set(rows.filter((row) => row.layout === 'ranked').flatMap(trackIdsOfRow));

export const requirePersonalTasteRows = (
  service: PersonalHomeTasteRowsService | undefined,
): PersonalHomeTasteRowsService => {
  if (!service) throw new Error('Home taste rows are not configured');
  return service;
};

export const buildPersonalExplorationRow = (
  service: PersonalHomeTasteRowsService | undefined,
  options: Parameters<PersonalHomeTasteRowsService['explorationRow']>[0],
) => requirePersonalTasteRows(service).explorationRow(options);

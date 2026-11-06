import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { progressiveOrderItems } from './home-feed-composer.js';
import { spreadPersonalExploration } from './home-personal-exploration.js';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import type { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';

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

const fallbackVoiceRows = (
  publicRows: HomeRow[],
  resumes: HomeRow[],
  recommendations: HomeRow[],
  masteredTrackIds: ReadonlySet<string>,
): HomeRow[] => {
  if (recommendations.some((row) => row.layout === 'vocal-range')) return [];
  const usedTrackIds = new Set([
    ...resumes.flatMap(trackIdsOfRow),
    ...recommendations.flatMap(trackIdsOfRow),
  ]);
  return publicRows.flatMap((row) => {
    if (row.layout !== 'vocal-range') return [];
    const items = row.items.filter(
      (item) => !usedTrackIds.has(item.id) && !masteredTrackIds.has(item.id),
    );
    return items.length >= 6 ? [{ ...row, items }] : [];
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
}: PersonalComposition): HomeRow[] => {
  const categories = [
    ...publicRows.filter(publicCategory),
    ...fallbackVoiceRows(
      publicRows,
      resumes,
      recommendations,
      masteredTrackIds,
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
  return spreadPersonalExploration({
    rows: progressiveRows(
      [...(hero ? [hero] : []), dailyTarget, ...resumes, ...prioritized],
      artistKeysByTrack,
    ),
    tasteByTrack,
    sourcePoolsByRow: explorationPoolsByRow,
    masteredTrackIds,
    reservedTrackIds: reservedChartTrackIds(publicRows),
    artistKeysByTrack,
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

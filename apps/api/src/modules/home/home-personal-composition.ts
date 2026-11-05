import type { HomeRow } from '@vozzify/contracts';
import { trackIdsOfRow } from './home-personal-resume-rows.js';
import type { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';

type PersonalComposition = {
  hero: HomeRow | undefined;
  dailyTarget: HomeRow;
  resumes: HomeRow[];
  socialRows: HomeRow[];
  publicRows: HomeRow[];
  recommendations: HomeRow[];
};

const publicCategory = (row: HomeRow): boolean =>
  row.layout === 'albums' ||
  row.layout === 'artists' ||
  row.layout === 'genres' ||
  row.layout === 'ranked';

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
}: PersonalComposition): HomeRow[] => {
  const categories = publicRows.filter(publicCategory);
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
  return [...(hero ? [hero] : []), dailyTarget, ...resumes, ...prioritized];
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

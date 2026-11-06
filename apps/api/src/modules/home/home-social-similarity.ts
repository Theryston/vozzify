import type { HomePeopleRow, HomePerson } from '@vozzify/contracts';
import {
  progressiveExposureFactor,
  socialAffinityScore,
} from './home-stage2-scoring.js';

const SOCIAL_MIN_COMMON_TRACKS = 3;
const SOCIAL_ROW_MIN_PEOPLE = 3;
const SOCIAL_ROW_MAX_PEOPLE = 24;

export type SocialCandidate = HomePerson & {
  vocalDistance: number | null;
  ownVisibleTracks?: number;
  otherVisibleTracks?: number;
  lastActivityAt?: string | null;
};

const affinity = (candidate: SocialCandidate): number =>
  socialAffinityScore(
    candidate.commonTracks,
    candidate.ownVisibleTracks ?? candidate.commonTracks,
    candidate.otherVisibleTracks ?? candidate.commonTracks,
  );

const recentActivity = (candidate: SocialCandidate): number =>
  candidate.lastActivityAt ? Date.parse(candidate.lastActivityAt) : 0;

const toPeople = (items: SocialCandidate[]) =>
  items.slice(0, SOCIAL_ROW_MAX_PEOPLE).map((person) => ({
    id: person.id,
    username: person.username,
    name: person.name,
    image: person.image,
    commonTracks: person.commonTracks,
  }));

const diversifySimilarPeople = (
  similar: SocialCandidate[],
  common: SocialCandidate[],
): SocialCandidate[] => {
  const commonRowIds = new Set(
    common.slice(0, SOCIAL_ROW_MAX_PEOPLE).map((person) => person.id),
  );
  return [...similar].sort((a, b) => {
    const aExposure = progressiveExposureFactor(commonRowIds.has(a.id) ? 1 : 0);
    const bExposure = progressiveExposureFactor(commonRowIds.has(b.id) ? 1 : 0);
    const aDistance = (a.vocalDistance ?? 0) / aExposure;
    const bDistance = (b.vocalDistance ?? 0) / bExposure;
    return (
      aDistance - bDistance ||
      affinity(b) - affinity(a) ||
      recentActivity(b) - recentActivity(a) ||
      a.id.localeCompare(b.id)
    );
  });
};

const rowsOf = (candidates: SocialCandidate[]): HomePeopleRow[] => {
  const common = candidates
    .filter((candidate) => candidate.commonTracks >= SOCIAL_MIN_COMMON_TRACKS)
    .sort(
      (a, b) =>
        affinity(b) - affinity(a) ||
        recentActivity(b) - recentActivity(a) ||
        a.id.localeCompare(b.id),
    );
  if (common.length < SOCIAL_ROW_MIN_PEOPLE) return [];
  const similar = common
    .filter((candidate) => candidate.vocalDistance !== null)
    .sort((a, b) => {
      if (a.vocalDistance !== b.vocalDistance) {
        return (a.vocalDistance ?? 0) - (b.vocalDistance ?? 0);
      }
      return (
        affinity(b) - affinity(a) ||
        recentActivity(b) - recentActivity(a) ||
        a.id.localeCompare(b.id)
      );
    });
  const rows: HomePeopleRow[] = [
    {
      id: 'people-who-sing-what-you-sing',
      layout: 'people',
      title: { key: 'home.rows.peopleWhoSingWhatYouSing', params: {} },
      items: toPeople(common),
    },
  ];
  if (similar.length >= SOCIAL_ROW_MIN_PEOPLE) {
    const diversifiedSimilar = diversifySimilarPeople(similar, common);
    rows.push({
      id: 'similar-voices',
      layout: 'people',
      title: { key: 'home.rows.similarVoices', params: {} },
      items: toPeople(diversifiedSimilar),
    });
  }
  return rows;
};

/** Builds the two social rows from persisted batch-computed similarities. */
export const buildSocialRows = (
  candidates: SocialCandidate[],
): HomePeopleRow[] => rowsOf(candidates);

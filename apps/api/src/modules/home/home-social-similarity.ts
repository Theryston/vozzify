import type { HomePeopleRow, HomePerson } from '@vozzify/contracts';

const SOCIAL_MIN_COMMON_TRACKS = 3;
const SOCIAL_ROW_MIN_PEOPLE = 3;
const SOCIAL_ROW_MAX_PEOPLE = 24;

export type SocialCandidate = HomePerson & {
  vocalDistance: number | null;
};

const rowsOf = (candidates: SocialCandidate[]): HomePeopleRow[] => {
  const common = candidates
    .filter((candidate) => candidate.commonTracks >= SOCIAL_MIN_COMMON_TRACKS)
    .sort(
      (a, b) => b.commonTracks - a.commonTracks || a.id.localeCompare(b.id),
    );
  if (common.length < SOCIAL_ROW_MIN_PEOPLE) return [];
  const similar = common
    .filter((candidate) => candidate.vocalDistance !== null)
    .sort((a, b) => {
      if (a.vocalDistance !== b.vocalDistance) {
        return (a.vocalDistance ?? 0) - (b.vocalDistance ?? 0);
      }
      return b.commonTracks - a.commonTracks || a.id.localeCompare(b.id);
    });
  const toPeople = (items: SocialCandidate[]) =>
    items.slice(0, SOCIAL_ROW_MAX_PEOPLE).map((person) => ({
      id: person.id,
      username: person.username,
      name: person.name,
      image: person.image,
      commonTracks: person.commonTracks,
    }));
  const rows: HomePeopleRow[] = [
    {
      id: 'people-who-sing-what-you-sing',
      layout: 'people',
      title: { key: 'home.rows.peopleWhoSingWhatYouSing', params: {} },
      items: toPeople(common),
    },
  ];
  if (similar.length >= SOCIAL_ROW_MIN_PEOPLE) {
    rows.push({
      id: 'similar-voices',
      layout: 'people',
      title: { key: 'home.rows.similarVoices', params: {} },
      items: toPeople(similar),
    });
  }
  return rows;
};

/** Builds the two social rows from persisted batch-computed similarities. */
export const buildSocialRows = (
  candidates: SocialCandidate[],
): HomePeopleRow[] => rowsOf(candidates);

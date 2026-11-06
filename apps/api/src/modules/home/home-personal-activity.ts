import type { UserFavoriteSignal } from './home-personal.repository.js';
import type { UserTasteActivity } from './home-personal.repository.types.js';
import type { TasteSignal } from './home-personal-recommendations.js';
import { singerContribution } from './home-stage2-scoring.js';

const FALLBACK_TIME_ZONE = 'UTC';
type DayKeyOf = (date: Date, timeZone: string) => string;

/** Keep each activity separate so its age decays before aggregation. */
export const tasteSignalsOf = (
  activities: UserTasteActivity[],
  favorites: UserFavoriteSignal[],
  dayKeyOf: DayKeyOf,
  timeZone: string | null = FALLBACK_TIME_ZONE,
): TasteSignal[] => [
  ...groupPracticeActivities(
    activities,
    dayKeyOf,
    timeZone ?? FALLBACK_TIME_ZONE,
  ),
  ...favorites.map((favorite) => ({
    genres: favorite.genres,
    artistKey: favorite.artistKey,
    weight: 1,
    lastSignalAt: favorite.createdAt,
  })),
];

const groupPracticeActivities = (
  activities: UserTasteActivity[],
  dayKeyOf: DayKeyOf,
  timeZone: string,
): TasteSignal[] => {
  const groups = new Map<string, UserTasteActivity[]>();
  for (const activity of activities) {
    const day = dayKeyOf(activity.createdAt, timeZone);
    const key = `${activity.trackId}:${day}`;
    const group = groups.get(key) ?? [];
    group.push(activity);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => {
    const latest = group.reduce((mostRecent, activity) =>
      activity.createdAt > mostRecent.createdAt ? activity : mostRecent,
    );
    const [first] = group;
    return first
      ? [
          {
            genres: first.genres,
            artistKey: first.artistKey,
            weight: singerContribution(group.length),
            lastSignalAt: latest.createdAt,
          },
        ]
      : [];
  });
};

export const personalBreadth = (options: {
  activities: UserTasteActivity[];
  favorites: UserFavoriteSignal[];
  timeZone: string | null;
  dayKeyOf: DayKeyOf;
}): { distinctTracks: number; activeDays: number } => {
  const zone = options.timeZone ?? FALLBACK_TIME_ZONE;
  const trackIds = new Set<string>();
  const activeDays = new Set<string>();
  for (const activity of options.activities) {
    trackIds.add(activity.trackId);
    activeDays.add(options.dayKeyOf(activity.createdAt, zone));
  }
  for (const favorite of options.favorites) {
    trackIds.add(favorite.trackId);
    activeDays.add(options.dayKeyOf(favorite.createdAt, zone));
  }
  return { distinctTracks: trackIds.size, activeDays: activeDays.size };
};

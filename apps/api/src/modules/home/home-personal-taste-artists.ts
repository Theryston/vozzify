import type { HomeArtist, HomeArtistsRow, HomeRow } from '@vozzify/contracts';
import type { AttemptsService } from '../attempts/attempts.service.js';
import type { MostSungArtistActivity } from '../attempts/profile-chips-ranking.js';
import { rankTasteArtists } from './home-personal-recommendations.js';
import { HOME_ROW_RULES } from './home-rules.js';

const title = (key: string) => ({ key, params: {} });
export const mostSungArtistsRow = async (
  attempts: AttemptsService,
  userId: string,
): Promise<HomeRow | undefined> => {
  const activities: MostSungArtistActivity[] =
    await attempts.mostSungArtistActivities(userId);
  const artists = rankTasteArtists(
    activities.map((activity) => ({
      artistId: activity.artist.id,
      name: activity.artist.name,
      attempts: 1,
      lastAttemptAt: activity.lastAttemptAt,
    })),
  ).slice(0, HOME_ROW_RULES.artists.maxItems);
  if (artists.length < HOME_ROW_RULES.artists.minItems) return undefined;
  return {
    id: 'your-most-sung-artists',
    layout: 'artists',
    title: title('home.rows.yourMostSungArtists'),
    items: artists.map(
      (artist): HomeArtist => ({
        id: artist.artistId,
        name: artist.name,
      }),
    ),
  } satisfies HomeArtistsRow;
};

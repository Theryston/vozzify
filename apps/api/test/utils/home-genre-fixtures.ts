import type { Database } from '../../src/database/database.js';
import { trackProcessings } from '../../src/database/schema/track-processings.js';
import { tracks } from '../../src/database/schema/tracks.js';
import { testMbid } from './factories.js';

type GenreSeed = {
  score: number;
  genres?: string[];
  artist?: string;
  artistMbid?: string;
  completed?: boolean;
};

/** Bulk insertion keeps complete-catalog reference tests small and fast. */
export const seedGenreTracks = async (db: Database, seeds: GenreSeed[]) => {
  const inserted = await db
    .insert(tracks)
    .values(
      seeds.map((seed, index) => ({
        id: `genre-track-${index.toString().padStart(4, '0')}`,
        recordingMbid: testMbid(index + 1),
        title: `Genre Track ${index}`,
        trendingScore: seed.score,
        genres: seed.genres ?? ['pop'],
        artistCredit: [
          {
            name: seed.artist ?? `Artist ${index}`,
            joinPhrase: '',
            ...(seed.artistMbid ? { mbid: seed.artistMbid } : {}),
          },
        ],
        coverUrl: `https://cdn.example/genre-${index}.webp`,
        vocalRangeLowest: 48,
        vocalRangeHighest: 72,
      })),
    )
    .returning();
  await db.insert(trackProcessings).values(
    inserted.map((track, index) => ({
      trackId: track.id,
      status:
        seeds[index]?.completed === false
          ? ('QUEUED' as const)
          : ('COMPLETED' as const),
    })),
  );
  return inserted;
};

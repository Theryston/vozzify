import { inArray } from 'drizzle-orm';
import { expect } from 'vitest';
import {
  albumDiscs,
  albums,
  albumTracks,
} from '../../src/database/schema/albums.js';
import { artists, trackArtists } from '../../src/database/schema/artists.js';
import { practiceAttempts } from '../../src/database/schema/practice-attempts.js';
import { trackProcessings } from '../../src/database/schema/track-processings.js';
import { tracks } from '../../src/database/schema/tracks.js';
import { HomeRepository } from '../../src/modules/home/home.repository.js';
import { createAuthClient } from './auth.js';
import type { TestApp } from './create-test-app.js';
import { testMbid } from './factories.js';

type SignInAs = (
  username: string,
  email: string,
) => Promise<{
  user: { id: string };
  client: ReturnType<typeof createAuthClient>;
}>;

export const attemptValue = (
  userId: string,
  trackId: string,
  accuracy: number,
  createdAt: Date,
) => ({
  userId,
  trackId,
  difficulty: 'NORMAL' as const,
  octaveMode: 'ANY' as const,
  transposeSemitones: 0,
  speed: 1,
  accuracy,
  coverage: 0.95,
  forwardSkip: false,
  bleedSuspected: false,
  startedAt: new Date(createdAt.getTime() - 240_000),
  endedAt: createdAt,
  createdAt,
  updatedAt: createdAt,
});

const createCategoryPeople = async (testApp: TestApp) => {
  const createdArtists = await testApp.db
    .insert(artists)
    .values(
      Array.from({ length: 10 }, (_, index) => ({
        mbid: testMbid(60_000 + index),
        name: `Category Artist ${index + 1}`,
        genres: ['rock', 'pop'],
      })),
    )
    .returning();
  const createdAlbums = await testApp.db
    .insert(albums)
    .values(
      Array.from({ length: 10 }, (_, index) => ({
        mbid: testMbid(61_000 + index),
        title: `Category Album ${index + 1}`,
        primaryType: 'Album',
        secondaryTypes: [],
        year: 1975,
        genres: ['rock'],
        coverArtUrl: null,
      })),
    )
    .returning();
  return { artists: createdArtists, albums: createdAlbums };
};

const createCategoryTracks = async (testApp: TestApp) => {
  const rows = await testApp.db
    .insert(tracks)
    .values(
      Array.from({ length: 100 }, (_, index) => ({
        recordingMbid: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        title: `Category Track ${index + 1}`,
        lengthMs: 180_000 + index * 1_000,
        disambiguation: '',
        video: false,
        isrcs: [`CAT${String(index + 1).padStart(9, '0')}`],
        genres: [`genre-${index % 10}`, `genre-${(index + 1) % 10}`],
        coverUrl: `https://cdn.example/category-${index + 1}.webp`,
        vocalRangeLowest: 48,
        vocalRangeHighest: 53,
        trendingScore: index < 58 ? 100 - index : 1,
      })),
    )
    .returning();
  await testApp.db.insert(trackProcessings).values(
    rows.map((track) => ({
      trackId: track.id,
      status: 'COMPLETED' as const,
    })),
  );
  await testApp.db
    .update(tracks)
    .set({ createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1_000) })
    .where(
      inArray(
        tracks.id,
        rows.slice(58).map((track) => track.id),
      ),
    );
  return rows;
};

const linkTracksToCatalog = async (
  testApp: TestApp,
  tracksToLink: Awaited<ReturnType<typeof createCategoryTracks>>,
  createdArtists: Awaited<ReturnType<typeof createCategoryPeople>>['artists'],
  createdAlbums: Awaited<ReturnType<typeof createCategoryPeople>>['albums'],
): Promise<void> => {
  await testApp.db.insert(trackArtists).values(
    tracksToLink.map((track, index) => {
      const artist = createdArtists[Math.floor(index / 10)];
      if (!artist) throw new Error('Missing artist fixture');
      return { trackId: track.id, artistId: artist.id };
    }),
  );
  await testApp.db
    .insert(albumDiscs)
    .values(createdAlbums.map((album) => ({ albumId: album.id, position: 1 })));
  await testApp.db.insert(albumTracks).values(
    tracksToLink.map((track, index) => {
      const album = createdAlbums[Math.floor(index / 10)];
      if (!album) throw new Error('Missing album fixture');
      return {
        albumId: album.id,
        trackId: track.id,
        discPosition: 1,
        trackPosition: (index % 10) + 1,
      };
    }),
  );
};

export const createHomeDiscoveryFixture = async (
  testApp: TestApp,
  signInAs: SignInAs,
) => {
  const { artists: createdArtists, albums: createdAlbums } =
    await createCategoryPeople(testApp);
  const categoryTracks = await createCategoryTracks(testApp);
  await linkTracksToCatalog(
    testApp,
    categoryTracks,
    createdArtists,
    createdAlbums,
  );
  const { user } = await signInAs(
    'category_singer',
    'category-singer@example.com',
  );
  const recentAt = new Date();
  await testApp.db
    .insert(practiceAttempts)
    .values(
      categoryTracks
        .slice(0, 24)
        .map((track) => attemptValue(user.id, track.id, 0.5, recentAt)),
    );
  expect(
    await testApp.app
      .get(HomeRepository)
      .findMostSungTrackIds(
        100,
        new Date(Date.now() - 28 * 24 * 60 * 60 * 1_000),
      ),
  ).toHaveLength(24);
  return { categoryTracks, collectiveUserId: user.id };
};

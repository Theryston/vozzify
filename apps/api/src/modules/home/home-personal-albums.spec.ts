import type { HomeAlbum } from '@vozzify/contracts';
import { describe, expect, it } from 'vitest';
import type { PersonalTaste } from './home-personal.js';
import type { PersonalAlbumTrack } from './home-personal.repository.types.js';
import { rankPersonalAlbums } from './home-personal-albums.js';

const album = (id: string): HomeAlbum => ({
  id,
  title: id,
  coverArtUrl: null,
  year: null,
});

const track = (
  albumId: string,
  id: string,
  genre: string,
  trendingScore = 1,
): PersonalAlbumTrack => ({
  albumId,
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: 180_000,
  vocalRangeLowest: 60,
  vocalRangeHighest: 72,
  genres: [genre],
  trendingScore,
});

const taste: PersonalTaste = {
  genreSignals: new Map([['rock', 10]]),
  totalGenreSignals: 10,
  artistSignals: new Map(),
  totalArtistSignals: 0,
};

describe('rankPersonalAlbums', () => {
  it('blends residual global quality with mean Track affinity', () => {
    const ranked = rankPersonalAlbums({
      albums: [album('global'), album('personal')],
      tracks: [
        track('global', 'global-track', 'jazz', 100),
        track('personal', 'personal-track', 'rock', 20),
      ],
      popularityByTrack: new Map([
        ['global-track', 100],
        ['personal-track', 20],
      ]),
      taste,
      lambda: 0.8,
      voiceRange: null,
      voiceConfidence: 0,
    });

    expect(ranked.map(({ id }) => id)).toEqual(['personal', 'global']);
  });

  it("scores and deduplicates only each Album's remaining Tracks", () => {
    const ranked = rankPersonalAlbums({
      albums: [album('first'), album('second')],
      tracks: [
        track('first', 'shared', 'rock', 100),
        track('first', 'first-only', 'rock', 5),
        track('second', 'shared', 'rock', 100),
        track('second', 'second-only', 'jazz', 20),
      ],
      popularityByTrack: new Map([
        ['shared', 100],
        ['first-only', 5],
        ['second-only', 20],
      ]),
      taste,
      lambda: 0,
      voiceRange: null,
      voiceConfidence: 0,
    });

    expect(ranked.map(({ id }) => id)).toEqual(['second', 'first']);
  });

  it('keeps the collective Album order when the User has no history', () => {
    const ranked = rankPersonalAlbums({
      albums: [album('views-first'), album('practice-first')],
      tracks: [
        track('views-first', 'views-track', 'jazz', 1),
        track('practice-first', 'practice-track', 'rock', 100),
      ],
      popularityByTrack: new Map([
        ['views-track', 100],
        ['practice-track', 10],
      ]),
      taste: { ...taste, genreSignals: new Map(), totalGenreSignals: 0 },
      lambda: 0,
      voiceRange: null,
      voiceConfidence: 0,
    });

    expect(ranked.map(({ id }) => id)).toEqual([
      'views-first',
      'practice-first',
    ]);
  });

  it('uses locale Track scores when sufficient local evidence selects them', () => {
    const albums = [album('global-first'), album('locale-first')];
    const tracks = [
      track('global-first', 'global-track', 'jazz', 100),
      track('locale-first', 'locale-track', 'rock', 1),
    ];
    const base = {
      albums,
      tracks,
      taste: { ...taste, genreSignals: new Map(), totalGenreSignals: 0 },
      lambda: 0,
      voiceRange: null,
      voiceConfidence: 0,
    };

    const global = rankPersonalAlbums({
      ...base,
      popularityByTrack: new Map([
        ['global-track', 100],
        ['locale-track', 1],
      ]),
    });
    const locale = rankPersonalAlbums({
      ...base,
      popularityByTrack: new Map([
        ['global-track', 1],
        ['locale-track', 100],
      ]),
    });

    expect(global.map(({ id }) => id)).toEqual([
      'global-first',
      'locale-first',
    ]);
    expect(locale.map(({ id }) => id)).toEqual([
      'locale-first',
      'global-first',
    ]);
  });
});

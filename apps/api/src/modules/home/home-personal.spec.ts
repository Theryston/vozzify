import {
  artistAffinity,
  blendScore,
  genreAffinity,
  isMasteredTrack,
  PERSONAL_ARTIST_WEIGHT,
  PERSONAL_GENRE_WEIGHT,
  type PersonalTaste,
  personalLambda,
  personalScore,
  personalSnapshotStale,
} from './home-personal.js';

const tasteOf = (
  genres: Record<string, number>,
  artists: Record<string, number>,
): PersonalTaste => {
  const genreSignals = new Map(Object.entries(genres));
  const artistSignals = new Map(Object.entries(artists));
  return {
    genreSignals,
    totalGenreSignals: [...genreSignals.values()].reduce((a, b) => a + b, 0),
    artistSignals,
    totalArtistSignals: [...artistSignals.values()].reduce((a, b) => a + b, 0),
  };
};

describe('personalLambda', () => {
  it('is 0 without data, so the feed stays the public one', () => {
    expect(personalLambda(0, 0)).toBe(0);
  });

  it('is negative-safe', () => {
    expect(personalLambda(-3, 1)).toBe(0);
  });

  it('uses distinct Track and active-day evidence with a global floor', () => {
    expect(personalLambda(1, 1)).toBeCloseTo(0.133, 3);
    expect(personalLambda(20, 5)).toBeCloseTo(0.506, 3);
    expect(personalLambda(100, 100)).toBeCloseTo(0.762, 3);
  });

  it('keeps at least 20% of popularity at high confidence', () => {
    expect(personalLambda(100_000, 100_000)).toBeLessThanOrEqual(0.8);
    expect(personalLambda(100_000, 100_000)).toBeGreaterThan(0.79);
  });
});

describe('genreAffinity', () => {
  it('averages the genre shares over the Track genres', () => {
    const taste = tasteOf({ rock: 6, pop: 2 }, {});
    // (6/8 + 2/8) / 2 genres.
    expect(genreAffinity(['rock', 'pop'], taste.genreSignals, 8)).toBe(0.5);
  });

  it('reads an unknown genre as 0', () => {
    const taste = tasteOf({ rock: 6 }, {});
    expect(genreAffinity(['jazz'], taste.genreSignals, 6)).toBe(0);
  });

  it('reads an empty taste as 0', () => {
    expect(genreAffinity(['rock'], new Map(), 0)).toBe(0);
  });

  it('reads a Track without genres as 0', () => {
    const taste = tasteOf({ rock: 6 }, {});
    expect(genreAffinity([], taste.genreSignals, 6)).toBe(0);
  });
});

describe('artistAffinity', () => {
  it('is the artist share of all artist signals', () => {
    const taste = tasteOf({}, { queen: 3, abba: 1 });
    expect(artistAffinity('queen', taste.artistSignals, 4)).toBe(0.75);
  });

  it('reads an unknown artist and an empty taste as 0', () => {
    expect(artistAffinity('queen', new Map([['abba', 1]]), 1)).toBe(0);
    expect(artistAffinity('queen', new Map(), 0)).toBe(0);
  });
});

describe('personalScore', () => {
  it('weighs the artist more than the genres', () => {
    expect(PERSONAL_ARTIST_WEIGHT).toBeGreaterThan(PERSONAL_GENRE_WEIGHT);
  });

  it('stays between 0 and 1', () => {
    const taste = tasteOf({ rock: 5 }, { queen: 5 });
    expect(personalScore(['rock'], 'queen', taste)).toBeLessThanOrEqual(1);
    expect(personalScore(['jazz'], 'abba', taste)).toBe(0);
  });

  it('prefers an artist match over a genre match alone', () => {
    const taste = tasteOf({ rock: 4 }, { queen: 4 });
    const byArtist = personalScore(['pop'], 'queen', taste);
    const byGenre = personalScore(['rock'], 'abba', taste);
    expect(byArtist).toBeGreaterThan(byGenre);
  });
});

describe('blendScore', () => {
  it('is the popularity alone at λ = 0', () => {
    expect(blendScore(0.8, 0.2, 0)).toBe(0.8);
  });

  it('is the personal score alone at λ = 1', () => {
    expect(blendScore(0.8, 0.2, 1)).toBe(0.2);
  });

  it('mixes both in between', () => {
    expect(blendScore(1, 0, 0.25)).toBe(0.75);
  });
});

describe('isMasteredTrack', () => {
  it('is true from the hit band on (85%)', () => {
    expect(isMasteredTrack(0.85)).toBe(true);
    expect(isMasteredTrack(0.99)).toBe(true);
  });

  it('is false below it', () => {
    expect(isMasteredTrack(0.849)).toBe(false);
    expect(isMasteredTrack(0.6)).toBe(false);
  });
});

describe('personalSnapshotStale', () => {
  it('is false for a fresh snapshot', () => {
    const generatedAt = new Date(Date.now() - 1000).toISOString();
    expect(personalSnapshotStale(generatedAt, 6 * 60 * 60)).toBe(false);
  });

  it('is true past the limit', () => {
    const generatedAt = new Date(
      Date.now() - (6 * 60 * 60 + 1) * 1000,
    ).toISOString();
    expect(personalSnapshotStale(generatedAt, 6 * 60 * 60)).toBe(true);
  });
});

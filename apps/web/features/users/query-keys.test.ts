import { describe, expect, it } from 'vitest';

import { practiceHistoryKey, profileKeys } from './query-keys';

describe('profileKeys', () => {
  it('builds stable keys per Profile', () => {
    expect(profileKeys.favorites('ada_lovelace')).toEqual([
      'users',
      'ada_lovelace',
      'favorites',
    ]);
  });

  it('separates infinite keys by Profile and page size', () => {
    expect(profileKeys.infiniteFavorites('ada_lovelace', 20)).toEqual([
      'users',
      'ada_lovelace',
      'favorites',
      'infinite',
      { limit: 20 },
    ]);
    expect(profileKeys.infiniteFavorites('ada_lovelace', 20)).not.toEqual(
      profileKeys.infiniteFavorites('grace', 20),
    );
  });
});

describe('practiceHistoryKey', () => {
  it('builds a stable key per Profile', () => {
    expect(practiceHistoryKey('ada_lovelace')).toEqual([
      'users',
      'ada_lovelace',
      'practice-history',
    ]);
  });

  it('keeps two Profiles apart', () => {
    expect(practiceHistoryKey('ada_lovelace')).not.toEqual(
      practiceHistoryKey('grace'),
    );
  });

  it('keeps owner data out of the visitor history cache', () => {
    expect(practiceHistoryKey('ada_lovelace', true)).not.toEqual(
      practiceHistoryKey('ada_lovelace'),
    );
  });
});

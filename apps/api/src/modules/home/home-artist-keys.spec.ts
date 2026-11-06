import { describe, expect, it } from 'vitest';
import { homeArtistKeys } from './home-artist-keys.js';

describe('homeArtistKeys', () => {
  it('uses canonical IDs before names when grouping Artist credits', () => {
    expect(
      homeArtistKeys(
        [
          { name: 'Shared Name', mbid: 'artist-mbid' },
          { name: 'Shared Name', artistId: 'catalog-artist' },
        ],
        'track-id',
      ),
    ).toEqual(['artist-mbid', 'catalog-artist']);
  });

  it('uses a normalized name only when a canonical identity is unavailable', () => {
    expect(
      homeArtistKeys(
        [{ name: '  Shared Name ' }, { name: 'shared name' }],
        'track-id',
      ),
    ).toEqual(['shared name']);
  });
});

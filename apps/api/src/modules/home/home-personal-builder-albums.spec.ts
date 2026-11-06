import type { HomeRow } from '@vozzify/contracts';
import type { PersonalHomeRepository } from './home-personal.repository.js';
import { personalizeAlbumRows } from './home-personal-builder-albums.js';
import { decayedTaste } from './home-personal-recommendations.js';

const albumRow: HomeRow = {
  id: 'featured-albums',
  layout: 'albums',
  title: { key: 'home.rows.featuredAlbums', params: {} },
  items: [
    { id: 'public-selection', title: 'Public', coverArtUrl: null, year: 2000 },
  ],
};

describe('personal Album ranking from the shared candidate snapshot', () => {
  it('can select outside the visible public Albums without scanning the catalog', async () => {
    const findAlbumTracks = vi.fn().mockResolvedValue([
      {
        albumId: 'public-selection',
        id: 'public-track',
        title: 'Public track',
        coverUrl: null,
        artistCredit: [],
        durationMs: 180_000,
        vocalRangeLowest: null,
        vocalRangeHighest: null,
        genres: ['rock'],
        trendingScore: 0,
      },
      {
        albumId: 'personal-candidate',
        id: 'personal-track',
        title: 'Personal track',
        coverUrl: null,
        artistCredit: [],
        durationMs: 180_000,
        vocalRangeLowest: null,
        vocalRangeHighest: null,
        genres: ['rock'],
        trendingScore: 0,
      },
    ]);
    const rows = await personalizeAlbumRows({
      publicRows: [albumRow],
      locale: 'en',
      taste: decayedTaste([]),
      lambda: 0,
      userRange: null,
      voiceConfidence: 0,
      albumCandidates: [
        {
          id: 'public-selection',
          title: 'Public',
          coverArtUrl: null,
          year: 2000,
          availableTracks: [{ id: 'public-track', popularity: 0.1 }],
        },
        {
          id: 'personal-candidate',
          title: 'Personal candidate',
          coverArtUrl: null,
          year: 2001,
          availableTracks: [{ id: 'personal-track', popularity: 0.9 }],
        },
      ],
      personal: { findAlbumTracks } as unknown as PersonalHomeRepository,
    });

    expect(findAlbumTracks).toHaveBeenCalledWith([
      'public-selection',
      'personal-candidate',
    ]);
    const selected = rows[0];
    expect(selected?.layout).toBe('albums');
    if (selected?.layout !== 'albums') {
      throw new Error('Expected the Album Row');
    }
    expect(selected.items[0]?.id).toBe('personal-candidate');
  });
});

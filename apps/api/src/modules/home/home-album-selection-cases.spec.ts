import type { HomeAlbumCandidateRecord } from './home-album-selection.js';
import { selectUsefulAlbums } from './home-album-selection.js';

const candidate = ({
  id,
  trackId,
  popularity,
  title,
  primaryType,
}: {
  id: string;
  trackId: string;
  popularity: number;
  title: string;
  primaryType: string;
}): HomeAlbumCandidateRecord => ({
  id,
  title,
  coverArtUrl: null,
  year: null,
  primaryType,
  secondaryTypes: [],
  availableTracks: [{ id: trackId, popularity }],
});

describe('Album identity and single eligibility', () => {
  it('keeps Albums containing distinct Recording identities even with the same title', () => {
    const selected = selectUsefulAlbums(
      [
        candidate({
          id: 'studio-album',
          trackId: 'studio-recording',
          popularity: 20,
          title: 'Same title',
          primaryType: 'Album',
        }),
        candidate({
          id: 'live-album',
          trackId: 'live-recording',
          popularity: 10,
          title: 'Same title',
          primaryType: 'Album',
        }),
      ],
      12,
    );

    expect(selected.map(({ id }) => id)).toEqual([
      'studio-album',
      'live-album',
    ]);
  });

  it('leaves a useful Single eligible despite its one-Track variety', () => {
    const selected = selectUsefulAlbums(
      [
        candidate({
          id: 'single',
          trackId: 'recording',
          popularity: 12,
          title: 'One song',
          primaryType: 'Single',
        }),
      ],
      12,
    );

    expect(selected.map(({ id }) => id)).toEqual(['single']);
  });
});

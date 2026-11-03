import { catalogTracksPageSchema } from '@vozzify/contracts';
import { testMbid } from '../../../test/utils/factories.js';

describe('Artist track release counts', () => {
  it.each([0, 30, 31, 84])(
    'serializes all %i releases of a recording',
    (releaseCount) => {
      const releases = Array.from({ length: releaseCount }, (_, index) => ({
        mbid: testMbid(index + 1),
        title: `Release ${index + 1}`,
        year: 2017,
        coverArtUrl: null,
      }));
      const page = {
        items: [
          {
            id: 'track-1',
            title: 'Perfect',
            lengthMs: 263_000,
            disambiguation: '',
            video: false,
            isrcs: [],
            artists: [{ id: 'artist-1', name: 'Ed Sheeran' }],
            genres: [],
            releases,
          },
        ],
        nextCursor: null,
      };

      expect(catalogTracksPageSchema.parse(page)).toEqual(page);
    },
  );
});

import { Test } from '@nestjs/testing';
import { AttemptsService } from '../attempts/attempts.service.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { decayedTaste } from './home-personal-recommendations.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';

describe('expanded personal candidate replenishment', () => {
  it('keeps requesting bounded source pages beyond the previous four-page cutoff', async () => {
    const cards = Array.from({ length: 301 }, (_, index) => ({
      id: `track-${index}`,
      title: `Track ${index}`,
      coverUrl: null,
      artistCredit: [{ name: `Artist ${index}`, joinPhrase: '' }],
      durationMs: null,
      vocalRangeLowest: null,
      vocalRangeHighest: null,
      genres: ['rock'],
      trendingScore: 1000 - index,
    }));
    const personal = {
      findPopularTasteCandidates: vi.fn(async (limit: number, offset: number) =>
        cards.slice(offset, offset + limit),
      ),
    };
    const repository = {
      findTracksForGenres: vi.fn().mockResolvedValue([]),
      findNewestTracks: vi.fn().mockResolvedValue([]),
      findMostSungTracks: vi.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        PersonalHomeTasteRowsService,
        { provide: PersonalHomeRepository, useValue: personal },
        { provide: PersonalHomeTasteRepository, useValue: repository },
        { provide: AttemptsService, useValue: {} },
      ],
    }).compile();
    try {
      const candidates = await module
        .get(PersonalHomeTasteRowsService)
        .findDiscoveryCandidates(decayedTaste([]), {
          excludedTrackIds: new Set(),
          expandRecommendationRows: true,
        });
      expect(candidates.byRow['trending-today']).toHaveLength(301);
      expect(candidates.tracks.at(-1)?.id).toBe('track-300');
      expect(
        personal.findPopularTasteCandidates.mock.calls.every(
          ([limit]) => limit === 60,
        ),
      ).toBe(true);
      expect(candidates.byRow['most-sung']).toEqual([]);
    } finally {
      await module.close();
    }
  });
});

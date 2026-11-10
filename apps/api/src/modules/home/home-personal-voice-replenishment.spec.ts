import { Test } from '@nestjs/testing';
import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { AttemptsService } from '../attempts/attempts.service.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { PersonalCandidateSession } from './home-personal-candidate-session.js';
import { composePersonalHomeRows } from './home-personal-composition.js';
import { decayedTaste } from './home-personal-recommendations.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { buildPersonalVoiceRows } from './home-personal-voice.js';

const dailyTarget: HomeRow = {
  id: 'daily-target',
  layout: 'daily-target',
  title: { key: 'home.rows.dailyTarget', params: {} },
  secondsLeft: 60,
  targetSeconds: 300,
  streakDays: 1,
  completedToday: false,
};
const catalog: HomeRow = {
  id: 'recommended-for-you',
  layout: 'standard',
  title: { key: 'home.rows.forYou', params: {} },
  items: Array.from(
    { length: 48 },
    (_, index): HomeTrack => ({
      id: `catalog-${index}`,
      title: `Catalog ${index}`,
      coverUrl: null,
      artistCredit: [],
      durationMs: null,
      vocalRange: null,
    }),
  ),
};

describe('personal voice replenishment across the retention budget', () => {
  it('fills the later challenge target without dropping selected fits or scoring every fit', async () => {
    const cards = Array.from({ length: 1260 }, (_, index) => ({
      id: `track-${index}`,
      title: `Track ${index}`,
      coverUrl: null,
      artistCredit: [{ name: `Artist ${index}`, joinPhrase: '' }],
      durationMs: null,
      vocalRangeLowest: index < 1200 ? 60 : 59,
      vocalRangeHighest: index < 1200 ? 68 : 69,
      genres: ['rock'],
      trendingScore: 2000 - index,
    }));
    const voice = vi.fn(
      async (_range: unknown, limit: number, offset: number) =>
        cards.slice(offset, offset + limit),
    );
    const module = await Test.createTestingModule({
      providers: [
        PersonalHomeTasteRowsService,
        {
          provide: PersonalHomeRepository,
          useValue: {
            findPopularTasteCandidates: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PersonalHomeTasteRepository,
          useValue: {
            findTracksForGenres: vi.fn().mockResolvedValue([]),
            findNewestTracks: vi.fn().mockResolvedValue([]),
            findMostSungTracks: vi.fn().mockResolvedValue([]),
            findVoiceCandidates: voice,
          },
        },
        { provide: AttemptsService, useValue: {} },
      ],
    }).compile();
    try {
      const range = { lowest: 60, highest: 68 };
      const session = new PersonalCandidateSession(new Set(), range);
      const service = module.get(PersonalHomeTasteRowsService);
      const observedIds = new Set<string>();
      let rows: HomeRow[] = [];
      do {
        const candidates = await service.findDiscoveryCandidates(
          decayedTaste([]),
          {
            excludedTrackIds: new Set(),
            userRange: range,
            candidateSession: session,
          },
        );
        for (const track of candidates.tracks) observedIds.add(track.id);
        expect(candidates.tracks.length).toBeLessThanOrEqual(1152);
        const pools: Record<string, HomeTrack[]> = {};
        const voiceRows = buildPersonalVoiceRows({
          rows: [],
          candidateTracks: candidates.tracks,
          userRange: range,
          discovery: new Map(),
          masteredTrackIds: new Set(),
          alreadyUsedTrackIds: new Set(),
          sourcePoolsByRow: pools,
        });
        rows = composePersonalHomeRows({
          hero: undefined,
          dailyTarget,
          resumes: [],
          socialRows: [],
          publicRows: [],
          recommendations: [...voiceRows, catalog],
          explorationPoolsByRow: new Map(Object.entries(pools)),
          expandRecommendationRows: true,
        });
      } while (session.needsMore(rows));
      const within = rows.find(({ id }) => id === 'within-your-voice');
      const challenge = rows.find(({ id }) => id === 'challenge-your-range');
      if (
        within?.layout !== 'vocal-range' ||
        challenge?.layout !== 'vocal-range'
      )
        throw new Error('A voice target was dropped');
      expect(within.items).toHaveLength(48);
      expect(challenge.items).toHaveLength(48);
      expect(
        challenge.items.every(
          (track) =>
            track.vocalRange.lowest === 59 && track.vocalRange.highest === 69,
        ),
      ).toBe(true);
      expect(within.items.slice(0, 2).map(({ id }) => id)).toEqual([
        'track-0',
        'track-1',
      ]);
      expect(voice.mock.calls.at(-1)?.[2]).toBe(1200);
      expect(observedIds.size).toBeLessThan(600);
    } finally {
      await module.close();
    }
  });
});

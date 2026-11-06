import { Test } from '@nestjs/testing';
import { AttemptsService } from '../attempts/attempts.service.js';
import type { PersonalTaste } from './home-personal.js';
import {
  PersonalHomeRepository,
  type UserTrackSignal,
} from './home-personal.repository.js';
import type { PersonalTrackCandidate } from './home-personal.repository.types.js';
import {
  decayedTaste,
  type TasteSignal,
} from './home-personal-recommendations.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';

const cards = Array.from({ length: 12 }, (_, index) => ({
  id: `track-${index}`,
  title: `Track ${index}`,
  coverUrl: `https://cdn.example/${index}.webp`,
  artistCredit: [],
  durationMs: 180_000,
  vocalRangeLowest: null,
  vocalRangeHighest: null,
  genres: ['rock'],
  trendingScore: 12 - index,
})) satisfies PersonalTrackCandidate[];

const signal = {
  trackId: 'source',
  attempts: 1,
  bestAccuracy: 0.7,
  lastAttemptAt: new Date(),
  genres: ['rock'],
  artistKey: 'source-artist',
  title: 'Source track',
  coverUrl: 'https://cdn.example/source.webp',
  artistCredit: [],
  durationMs: 180_000,
  vocalRangeLowest: null,
  vocalRangeHighest: null,
} satisfies UserTrackSignal;

const tasteSignals: TasteSignal[] = Array.from({ length: 4 }, () => ({
  genres: ['rock'],
  artistKey: 'source-artist',
  weight: 1,
  lastSignalAt: new Date(),
}));

const createService = async (
  personal: PersonalHomeRepository,
  tasteRepository: PersonalHomeTasteRepository,
  attempts: { mostSungArtistActivities: ReturnType<typeof vi.fn> },
) => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PersonalHomeTasteRowsService,
      { provide: PersonalHomeRepository, useValue: personal },
      { provide: PersonalHomeTasteRepository, useValue: tasteRepository },
      { provide: AttemptsService, useValue: attempts },
    ],
  }).compile();
  return moduleRef.get(PersonalHomeTasteRowsService);
};

describe('PersonalHomeTasteRowsService', () => {
  it('refills after mastery exclusions and independently loads voice candidates', async () => {
    const catalog = Array.from({ length: 240 }, (_, index) => ({
      ...cards[0],
      id: `catalog-${index}`,
    }));
    const excluded = new Set(catalog.slice(0, 180).map((card) => card.id));
    const voiceOnly = {
      ...cards[0],
      id: 'voice-only',
      vocalRangeLowest: 60,
      vocalRangeHighest: 72,
    };
    const personal = {
      findPopularTasteCandidates: vi.fn(
        async (limit: number, offset: number, excludedIds: string[]) =>
          catalog
            .filter((card) => !excludedIds.includes(card.id))
            .slice(offset, offset + limit),
      ),
    } as unknown as PersonalHomeRepository;
    const tasteRepository = {
      findTracksForGenres: vi.fn().mockResolvedValue([]),
      findNewestTracks: vi.fn().mockResolvedValue([]),
      findMostSungTracks: vi.fn().mockResolvedValue([]),
      findVoiceCandidates: vi.fn(async (_range: unknown, limit: number) =>
        [voiceOnly].slice(0, limit),
      ),
    } as unknown as PersonalHomeTasteRepository;
    const service = await createService(personal, tasteRepository, {
      mostSungArtistActivities: vi.fn(),
    });

    const candidates = await service.findDiscoveryCandidates(
      decayedTaste(tasteSignals),
      { excludedTrackIds: excluded, userRange: { lowest: 60, highest: 72 } },
    );

    expect(personal.findPopularTasteCandidates).toHaveBeenCalledTimes(2);
    expect(personal.findPopularTasteCandidates).toHaveBeenNthCalledWith(
      1,
      60,
      0,
      [...excluded],
    );
    expect(candidates.byRow['trending-today']?.map(({ id }) => id)).toEqual(
      catalog.slice(180).map(({ id }) => id),
    );
    expect(candidates.byRow['within-your-voice']?.[0]?.id).toBe('voice-only');
    expect(candidates.byRow['challenge-your-range']?.[0]?.id).toBe(
      'voice-only',
    );
    expect(tasteRepository.findVoiceCandidates).toHaveBeenNthCalledWith(
      1,
      { lowest: 60, highest: 72 },
      60,
      0,
      [...excluded],
    );
    expect(candidates.tracks.some(({ id }) => id === 'voice-only')).toBe(true);
  });

  it('refills the genre-specific row after mastered and already-used Tracks', async () => {
    const excludedIds = Array.from(
      { length: 240 },
      (_, index) => `old-${index}`,
    );
    const alternatives = Array.from({ length: 60 }, (_, index) => ({
      ...cards[index % cards.length],
      id: `alternative-${index}`,
    }));
    const personal = {
      findUserSungTrackSources: vi.fn().mockResolvedValue([]),
    } as unknown as PersonalHomeRepository;
    const tasteRepository = {
      findTracksForGenres: vi.fn(
        async (
          _genres: string[],
          limit: number,
          offset: number,
          excluded: string[],
        ) =>
          alternatives
            .filter((candidate) => !excluded.includes(candidate.id))
            .slice(offset, offset + limit),
      ),
    } as unknown as PersonalHomeTasteRepository;
    const service = await createService(personal, tasteRepository, {
      mostSungArtistActivities: vi.fn().mockResolvedValue([]),
    });

    const rows = await service.build({
      userId: 'user',
      signals: [],
      tasteSignals,
      taste: decayedTaste(tasteSignals),
      mastered: new Set(excludedIds.slice(0, 180)),
      usedTrackIds: new Set(excludedIds.slice(180)),
      publicRows: [],
    });

    expect(tasteRepository.findTracksForGenres).toHaveBeenNthCalledWith(
      1,
      ['rock'],
      60,
      0,
      excludedIds,
    );
    expect(rows.find((row) => row.id === 'more-of-your-genres')).toMatchObject({
      layout: 'standard',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'alternative-0' }),
      ]),
    });
  });

  it('builds an exploration row from a three-to-five-track slot budget', async () => {
    const personal = {
      findTracksOutsideGenres: vi
        .fn()
        .mockResolvedValue(
          cards.slice(0, 3).map((card) => ({ ...card, genres: ['jazz'] })),
        ),
    } as unknown as PersonalHomeRepository;
    const service = await createService(
      personal,
      {} as PersonalHomeTasteRepository,
      { mostSungArtistActivities: vi.fn() },
    );
    const row = await service.explorationRow({
      taste: decayedTaste(tasteSignals),
      tasteSignals,
      mastered: new Set(),
      usedTrackIds: new Set(),
      visibleTrackSlots: 15,
    });
    expect(personal.findTracksOutsideGenres).toHaveBeenCalledOnce();
    expect(row?.id).toBe('explore');
    expect(row?.layout === 'standard' ? row.items : []).toHaveLength(3);
  });

  it('reserves co-occurrence Tracks before composing the genre row', async () => {
    const personal = {
      findUserSungTrackSources: vi
        .fn()
        .mockResolvedValue([{ trackId: 'source', lastAttemptAt: new Date() }]),
      findCommunityCooccurrence: vi.fn().mockResolvedValue(
        cards.slice(0, 6).map((card) => ({
          sourceTrackId: 'source',
          targetTrackId: card.id,
          score: 0.3,
        })),
      ),
      findCommunityTrackCards: vi
        .fn()
        .mockImplementation(async (ids: string[]) =>
          cards.filter((card) => ids.includes(card.id)),
        ),
    } as unknown as PersonalHomeRepository;
    const tasteRepository = {
      findTracksForGenres: vi.fn().mockResolvedValue(cards),
    } as unknown as PersonalHomeTasteRepository;
    const attempts = {
      mostSungArtistActivities: vi.fn().mockResolvedValue([]),
    };
    const service = await createService(personal, tasteRepository, attempts);
    const usedTrackIds = new Set<string>();
    const taste: PersonalTaste = decayedTaste(tasteSignals);

    const rows = await service.build({
      userId: 'user-1',
      signals: [signal],
      tasteSignals,
      taste,
      mastered: new Set(),
      usedTrackIds,
      publicRows: [],
    });

    const tracksByRow = rows
      .filter(
        (row): row is Extract<typeof row, { layout: 'standard' }> =>
          row.layout === 'standard',
      )
      .map((row) => row.items.map((track) => track.id));
    expect(tracksByRow).toHaveLength(2);
    expect(tracksByRow[0]).toHaveLength(6);
    expect(tracksByRow[1]).toHaveLength(6);
    expect(new Set(tracksByRow.flat()).size).toBe(12);
  });

  it('builds the most-sung artist row from valid attempt activities', async () => {
    const personal = {
      findUserSungTrackSources: vi.fn().mockResolvedValue([]),
      findCommunityCooccurrence: vi.fn().mockResolvedValue([]),
    } as unknown as PersonalHomeRepository;
    const tasteRepository = {
      findTracksForGenres: vi.fn().mockResolvedValue(cards),
    } as unknown as PersonalHomeTasteRepository;
    const activities = Array.from({ length: 6 }, (_, index) => ({
      artist: { id: `artist-${index}`, name: `Artist ${index}` },
      lastAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
    const attempts = {
      mostSungArtistActivities: vi.fn().mockResolvedValue(activities),
    };
    const service = await createService(personal, tasteRepository, attempts);
    const rows = await service.build({
      userId: 'user-1',
      signals: [signal],
      tasteSignals,
      taste: decayedTaste(tasteSignals),
      mastered: new Set(),
      usedTrackIds: new Set(),
      publicRows: [],
    });

    expect(attempts.mostSungArtistActivities).toHaveBeenCalledWith('user-1');
    expect(
      rows.find((row) => row.id === 'your-most-sung-artists'),
    ).toMatchObject({
      layout: 'artists',
      items: activities.map(({ artist }) => artist),
    });
  });
});

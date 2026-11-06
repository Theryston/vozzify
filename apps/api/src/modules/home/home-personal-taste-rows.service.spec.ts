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
          singers: 3,
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

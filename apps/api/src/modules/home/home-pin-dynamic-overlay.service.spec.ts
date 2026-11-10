import { Test, type TestingModule } from '@nestjs/testing';
import type { EditorialPin, HomeRow } from '@vozzify/contracts';
import { EditorialPinsService } from '../editorial-pins/editorial-pins.service.js';
import { HomeRepository, type HomeTrackRecord } from './home.repository.js';
import {
  HomePinOverlayService,
  PINNED_ROW_TITLE_KEY,
} from './home-pin-overlay.service.js';

const pins = { findLivePins: vi.fn(), findSourceTrackIds: vi.fn() };
const repository = { findCompletedTracksByIds: vi.fn() };

const record = (id: string): HomeTrackRecord => ({
  id,
  title: `Track ${id}`,
  coverUrl: `https://cdn.example/${id}.webp`,
  artistCredit: [{ name: `Artist ${id}`, joinPhrase: '' }],
  lengthMs: 180000,
  vocalRangeLowest: 60,
  vocalRangeHighest: 72,
});

const livePin = (overrides: Partial<EditorialPin> = {}): EditorialPin => ({
  id: 'pin-1',
  kind: 'row',
  layout: 'standard',
  source: { type: 'genre', genre: 'rock' },
  position: 1,
  priority: 0,
  audience: 'everyone',
  locale: null,
  startsAt: null,
  endsAt: null,
  titles: { en: 'Rock', 'pt-BR': 'Rock' },
  sponsored: false,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const feedRows = (): HomeRow[] => [
  {
    id: 'hero',
    layout: 'hero',
    track: {
      id: 'algo',
      title: 'Algorithmic',
      coverUrl: null,
      artistCredit: [],
      durationMs: null,
      vocalRange: null,
    },
  },
  {
    id: 'trending-today',
    layout: 'standard',
    title: { key: 'home.rows.trendingToday', params: {} },
    items: [
      {
        id: 'g1',
        title: 'Track g1',
        coverUrl: null,
        artistCredit: [],
        durationMs: null,
        vocalRange: null,
      },
    ],
  },
];

describe('HomePinOverlayService dynamic sources', () => {
  let service: HomePinOverlayService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    moduleRef = await Test.createTestingModule({
      providers: [
        HomePinOverlayService,
        { provide: EditorialPinsService, useValue: pins },
        { provide: HomeRepository, useValue: repository },
      ],
    }).compile();
    service = moduleRef.get(HomePinOverlayService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('resolves a genre pin when the feed is read, in the resolved order', async () => {
    pins.findLivePins.mockResolvedValue([livePin()]);
    pins.findSourceTrackIds.mockResolvedValue(['g1', 'g2']);
    repository.findCompletedTracksByIds.mockResolvedValue([
      record('g1'),
      record('g2'),
    ]);

    const rows = await service.apply(feedRows(), {
      locale: 'en',
      signedIn: false,
    });

    expect(pins.findSourceTrackIds).toHaveBeenCalledWith(
      { type: 'genre', genre: 'rock' },
      { requireCover: false, limit: 48 },
    );
    expect(repository.findCompletedTracksByIds).toHaveBeenCalledWith([
      'g1',
      'g2',
    ]);
    expect(rows[1]).toMatchObject({
      id: 'pin-pin-1',
      layout: 'standard',
      title: { key: PINNED_ROW_TITLE_KEY, params: { title: 'Rock' } },
      items: [
        expect.objectContaining({ id: 'g1' }),
        expect.objectContaining({ id: 'g2' }),
      ],
    });
  });

  it('keeps an album pin in album order and its Tracks out of the other rows', async () => {
    pins.findLivePins.mockResolvedValue([
      livePin({ source: { type: 'album', albumId: 'album-1' } }),
    ]);
    pins.findSourceTrackIds.mockResolvedValue(['g1', 'algo']);
    repository.findCompletedTracksByIds.mockResolvedValue([
      record('g1'),
      record('algo'),
    ]);

    const rows = await service.apply(feedRows(), {
      locale: 'en',
      signedIn: false,
    });

    expect(rows[0]).toMatchObject({
      id: 'pin-pin-1',
      items: [
        expect.objectContaining({ id: 'g1' }),
        expect.objectContaining({ id: 'algo' }),
      ],
    });
    // The algorithmic hero showed a pinned Track, so it is gone.
    expect(rows.find((row) => row.id === 'hero')).toBeUndefined();
  });

  it('skips a resolved Track that is no longer completed', async () => {
    pins.findLivePins.mockResolvedValue([livePin()]);
    pins.findSourceTrackIds.mockResolvedValue(['g1', 'g2']);
    repository.findCompletedTracksByIds.mockResolvedValue([record('g2')]);

    const rows = await service.apply(feedRows(), {
      locale: 'en',
      signedIn: false,
    });

    expect(rows[1]).toMatchObject({
      id: 'pin-pin-1',
      items: [expect.objectContaining({ id: 'g2' })],
    });
  });

  it('reads a hero pin with only Tracks that have a cover', async () => {
    pins.findLivePins.mockResolvedValue([
      livePin({ kind: 'hero', layout: 'hero', position: 0 }),
    ]);
    pins.findSourceTrackIds.mockResolvedValue(['g1']);
    repository.findCompletedTracksByIds.mockResolvedValue([record('g1')]);

    const rows = await service.apply(feedRows(), {
      locale: 'en',
      signedIn: false,
    });

    expect(pins.findSourceTrackIds).toHaveBeenCalledWith(
      { type: 'genre', genre: 'rock' },
      { requireCover: true, limit: 48 },
    );
    expect(rows[0]).toMatchObject({
      id: 'pin-pin-1',
      layout: 'hero',
      track: expect.objectContaining({ id: 'g1' }),
    });
  });

  it('resolves a dynamic row pin with up to 48 eligible Tracks', async () => {
    const trackIds = Array.from({ length: 48 }, (_, index) => `track-${index}`);
    pins.findLivePins.mockResolvedValue([livePin()]);
    pins.findSourceTrackIds.mockResolvedValue(trackIds);
    repository.findCompletedTracksByIds.mockResolvedValue(trackIds.map(record));

    const rows = await service.apply(feedRows(), {
      locale: 'en',
      signedIn: false,
    });

    expect(rows[1]?.layout).toBe('standard');
    if (rows[1]?.layout !== 'standard') {
      throw new Error('The dynamic Pin did not produce a standard Row');
    }
    expect(rows[1].items).toHaveLength(48);
    expect(rows[1].items.map(({ id }) => id)).toEqual(trackIds);
  });
});

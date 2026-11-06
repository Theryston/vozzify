import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { encodeHomeCursor } from './home-cursor.js';
import type { PersonalTrackCandidate } from './home-personal.repository.js';
import {
  decayedTaste,
  type TasteSignal,
} from './home-personal-recommendations.js';
import { personalHomeVersionFromStoredRows } from './home-personal-version.js';
import {
  createLinkedHomeFeeds,
  createPersonalHomeBuilder,
  createPersonalHomeRepositoryFixture,
  createRetiredHomeService,
  createTasteRows,
} from './home-retired-cursor-test-fixtures.js';

describe('HomeService retired personal taste cursors', () => {
  it('verifies linked taste and raw public credits for the correct owner', async () => {
    const track: HomeTrack = {
      id: 'public-track',
      title: 'Public song',
      coverUrl: null,
      artistCredit: [{ name: 'Singer', joinPhrase: '' }],
      durationMs: 180_000,
      vocalRange: null,
    };
    const publicRow: HomeRow = {
      id: 'new-tracks',
      layout: 'standard',
      title: { key: 'home.rows.newTracks', params: {} },
      items: [track],
    };
    const feeds = createLinkedHomeFeeds([publicRow]);
    const personal = createPersonalHomeRepositoryFixture();
    const tasteCards: PersonalTrackCandidate[] = Array.from(
      { length: 12 },
      (_, index) => ({
        id: `taste-track-${index}`,
        title: `Taste song ${index}`,
        coverUrl: `https://cdn.example/${index}.webp`,
        artistCredit: [{ name: `Singer ${index}`, joinPhrase: '' }],
        durationMs: 180_000,
        vocalRangeLowest: null,
        vocalRangeHighest: null,
        genres: ['rock'],
        trendingScore: 3 - index,
      }),
    );
    const tasteRepository = {
      findTracksForGenres: vi.fn().mockResolvedValue(tasteCards),
      findUserTasteActivities: vi.fn().mockResolvedValue([]),
    };
    const attempts = {
      mostSungArtistActivities: vi.fn().mockResolvedValue([]),
    };
    const tasteSignals: TasteSignal[] = Array.from({ length: 4 }, () => ({
      genres: ['rock'],
      artistKey: 'singer',
      weight: 1,
      lastSignalAt: new Date(),
    }));
    const tasteRowsService = await createTasteRows(
      personal,
      tasteRepository,
      attempts,
    );
    const generatedTasteRows = await tasteRowsService.build({
      userId: 'user-a',
      signals: [],
      tasteSignals,
      taste: decayedTaste(tasteSignals),
      mastered: new Set(),
      usedTrackIds: new Set(),
      publicRows: [publicRow],
    });
    expect(generatedTasteRows.map((row) => row.id)).toContain(
      'more-of-your-genres',
    );
    const tasteRows = {
      findUserTasteActivities: vi.fn().mockResolvedValue([]),
      build: vi.fn().mockResolvedValue(generatedTasteRows),
      explorationRow: vi.fn().mockResolvedValue(undefined),
    };
    const builder = await createPersonalHomeBuilder(feeds, personal, tasteRows);
    const built = await builder.build('user-a', 'en');
    const linkedTaste = built.rows.find(
      (row) => row.id === 'more-of-your-genres',
    );
    expect(linkedTaste?.layout).toBe('standard');
    if (linkedTaste?.layout !== 'standard') {
      throw new Error('Builder did not produce the expected taste row');
    }
    expect(linkedTaste.items[0]?.artistCredit[0]?.artistId).toBe('artist-1');

    expect(
      personalHomeVersionFromStoredRows(
        'user-a',
        built.locale,
        built.algorithmVersion,
        built.rows,
      ),
    ).toBe(built.version);
    const snapshots = {
      readCurrent: vi.fn().mockResolvedValue(undefined),
      readRetired: vi.fn().mockResolvedValue(built),
    };
    const service = await createRetiredHomeService(feeds, snapshots);
    const cursor = encodeHomeCursor({ version: built.version, position: 0 });

    const page = await service.getPage(cursor, 'en', 'user-a');
    expect(page.page.rows).toContainEqual(linkedTaste);
    await expect(service.getPage(cursor, 'en', 'user-b')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
  });
});

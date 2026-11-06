import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { encodeHomeCursor } from './home-cursor.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import {
  type UserFavoriteSignal,
  type UserTrackSignal,
} from './home-personal.repository.js';
import {
  createPersonalHomeBuilder,
  createRetiredHomeService,
} from './home-retired-cursor-test-fixtures.js';

describe('HomeService retired personal cursors', () => {
  it('serves an actual linked retired snapshot only to its hashed owner', async () => {
    const track: HomeTrack = {
      id: 'track-1',
      title: 'Song',
      coverUrl: null,
      artistCredit: [{ name: 'Singer', joinPhrase: '' }],
      durationMs: 180_000,
      vocalRange: null,
    };
    const rawRow: HomeRow = {
      id: 'new-tracks',
      layout: 'standard',
      title: { key: 'home.rows.newTracks', params: {} },
      items: [track],
    };
    const feeds = {
      currentPublic: vi.fn().mockResolvedValue({
        feed: {
          audience: 'public',
          locale: 'en',
          version: 'public-version',
          algorithmVersion: 1,
          rows: [],
        },
        cacheable: true,
      }),
      withArtistLinks: vi.fn(async (rows: HomeRow[]) =>
        rows.map((row) =>
          row.layout === 'standard'
            ? {
                ...row,
                items: row.items.map((item) => ({
                  ...item,
                  artistCredit: item.artistCredit.map((credit) => ({
                    ...credit,
                    artistId: 'artist-1',
                  })),
                })),
              }
            : row,
        ),
      ),
      publicVersion: vi.fn().mockResolvedValue(undefined),
    };
    const personal = {
      findUserTrackSignals: vi
        .fn<() => Promise<UserTrackSignal[]>>()
        .mockResolvedValue([]),
      findUserFavoriteSignals: vi
        .fn<() => Promise<UserFavoriteSignal[]>>()
        .mockResolvedValue([]),
      findDiscoveryTracks: vi.fn().mockResolvedValue(new Map()),
    };
    const tasteRows = {
      findUserTasteActivities: vi.fn().mockResolvedValue([]),
      build: vi.fn().mockResolvedValue([rawRow]),
      explorationRow: vi.fn().mockResolvedValue(undefined),
    };
    const builder = await createPersonalHomeBuilder(feeds, personal, tasteRows);
    const built = await builder.build('user-a', 'en');
    const linkedRow = built.rows.find((row) => row.id === 'new-tracks');
    expect(linkedRow?.layout).toBe('standard');
    if (linkedRow?.layout !== 'standard') {
      throw new Error('Builder did not produce the expected linked row');
    }
    expect(linkedRow.items[0]?.artistCredit[0]?.artistId).toBe('artist-1');

    const retired: StoredPersonalHomeFeed = built;
    const snapshots = {
      readCurrent: vi.fn().mockResolvedValue(undefined),
      readRetired: vi.fn().mockResolvedValue(retired),
    };
    const service = await createRetiredHomeService(feeds, snapshots);
    const cursor = encodeHomeCursor({ version: built.version, position: 0 });

    const page = await service.getPage(cursor, 'en', 'user-a');
    expect(page.page.rows).toContainEqual(linkedRow);
    await expect(service.getPage(cursor, 'en', 'user-b')).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
  });
});

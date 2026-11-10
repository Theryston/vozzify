import { Test } from '@nestjs/testing';
import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { HomeService } from './home.service.js';
import { encodeHomeCursor } from './home-cursor.js';
import {
  type StoredHomeFeed,
  type StoredPersonalHomeFeed,
} from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeQueueService } from './home-personal-queue.service.js';
import {
  HOME_ALGORITHM_VERSION,
  PERSONAL_SNAPSHOT_STALE_AFTER_SECONDS,
  PRIVATE_HOME_CACHE_CONTROL,
} from './home-rules.js';

const VERSION = 'a1b2c3d4e5f60718';

const rows = (count: number): HomeRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    layout: 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    items: [],
  }));

const feedOf = (version: string, count: number): StoredHomeFeed => ({
  audience: 'public',
  version,
  algorithmVersion: 1,
  rows: rows(count),
});

const rowIds = (page: { rows: HomeRow[] }) => page.rows.map((row) => row.id);

describe('HomeService', () => {
  let service: HomeService;
  const feeds = { currentPublic: vi.fn(), publicVersion: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [HomeService, { provide: HomeFeedService, useValue: feeds }],
    }).compile();
    service = moduleRef.get(HomeService);
  });
  it('answers the first six rows of the current feed with a cursor while rows remain', async () => {
    feeds.currentPublic.mockResolvedValue({
      feed: feedOf(VERSION, 8),
      cacheable: true,
    });

    const { page, cacheable } = await service.getPage(undefined);

    expect(cacheable).toBe(true);
    expect(page).toMatchObject({ audience: 'public', version: VERSION });
    expect(page.algorithmVersion).toBe(1);
    expect(rowIds(page)).toEqual([
      'row-0',
      'row-1',
      'row-2',
      'row-3',
      'row-4',
      'row-5',
    ]);
    expect(page.nextCursor).toBe(
      encodeHomeCursor({ version: VERSION, position: 6 }),
    );
  });

  it('answers no cursor on the last page', async () => {
    feeds.currentPublic.mockResolvedValue({
      feed: feedOf(VERSION, 4),
      cacheable: true,
    });

    const { page } = await service.getPage(undefined);

    expect(rowIds(page)).toEqual(['row-0', 'row-1', 'row-2', 'row-3']);
    expect(page.nextCursor).toBeNull();
  });

  it('answers an empty page with no cursor for an empty feed', async () => {
    feeds.currentPublic.mockResolvedValue({
      feed: feedOf(VERSION, 0),
      cacheable: true,
    });

    const { page } = await service.getPage(undefined);

    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('resumes a cursor at its position in the version it names', async () => {
    feeds.publicVersion.mockResolvedValue(feedOf(VERSION, 9));
    const cursor = encodeHomeCursor({ version: VERSION, position: 6 });

    const { page, cacheable } = await service.getPage(cursor);

    expect(feeds.publicVersion).toHaveBeenCalledWith(VERSION);
    expect(cacheable).toBe(true);
    expect(rowIds(page)).toEqual(['row-6', 'row-7', 'row-8']);
    expect(page.nextCursor).toBeNull();
  });

  it('answers 404 NOT_FOUND with the expired reason when the cursor names a version that is gone', async () => {
    feeds.publicVersion.mockResolvedValue(undefined);
    const cursor = encodeHomeCursor({
      version: '0000000000000000',
      position: 6,
    });

    const error = await service.getPage(cursor).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      details: { reason: 'FEED_VERSION_EXPIRED' },
    });
    expect((error as AppException).getStatus()).toBe(404);
  });

  it('refuses a malformed cursor before looking up any feed', async () => {
    const error = await service.getPage('garbage').catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(feeds.publicVersion).not.toHaveBeenCalled();
  });

  it('passes the uncacheable fallback home through', async () => {
    feeds.currentPublic.mockResolvedValue({
      feed: feedOf('minimal', 0),
      cacheable: false,
    });

    await expect(service.getPage(undefined)).resolves.toMatchObject({
      cacheable: false,
    });
  });
});

describe('HomeService for a signed-in visitor', () => {
  let service: HomeService;
  const feeds = { currentPublic: vi.fn(), publicVersion: vi.fn() };
  const snapshots = { readCurrent: vi.fn(), readRetired: vi.fn() };
  const refresh = { requestRefresh: vi.fn() };

  const personalOf = (
    version: string,
    generatedAt: string,
  ): StoredPersonalHomeFeed => ({
    audience: 'personal',
    locale: 'en',
    version,
    algorithmVersion: 1,
    rows: rows(4).map((row, index) => ({ ...row, id: `mine-${index}` })),
    generatedAt,
  });

  const freshAt = () => new Date().toISOString();
  const staleAt = () =>
    new Date(
      Date.now() - (PERSONAL_SNAPSHOT_STALE_AFTER_SECONDS + 60) * 1000,
    ).toISOString();

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: HomeFeedService, useValue: feeds },
        { provide: PersonalHomeStore, useValue: snapshots },
        { provide: PersonalHomeQueueService, useValue: refresh },
      ],
    }).compile();
    service = moduleRef.get(HomeService);
  });

  it('serves the fresh snapshot as personal with private headers', async () => {
    snapshots.readCurrent.mockResolvedValue({
      ...personalOf('b2c3d4e5f6a70819', freshAt()),
      algorithmVersion: HOME_ALGORITHM_VERSION,
    });

    const { page, cacheControl } = await service.getPage(
      undefined,
      'en',
      'user-1',
    );

    expect(page).toMatchObject({
      audience: 'personal',
      version: 'b2c3d4e5f6a70819',
    });
    expect(rowIds(page)).toEqual(['mine-0', 'mine-1', 'mine-2', 'mine-3']);
    expect(page.nextCursor).toBeNull();
    expect(cacheControl).toBe(PRIVATE_HOME_CACHE_CONTROL);
    expect(refresh.requestRefresh).not.toHaveBeenCalled();
  });

  it('serves a stale snapshot and queues its rebuild', async () => {
    snapshots.readCurrent.mockResolvedValue(
      personalOf('b2c3d4e5f6a70819', staleAt()),
    );

    const { page } = await service.getPage(undefined, 'en', 'user-1');

    expect(page.audience).toBe('personal');
    expect(refresh.requestRefresh).toHaveBeenCalledWith('user-1', 'en');
  });

  it('serves the public rows as personal while the rebuild runs', async () => {
    snapshots.readCurrent.mockResolvedValue(undefined);
    feeds.currentPublic.mockResolvedValue({
      feed: feedOf(VERSION, 8),
      cacheable: true,
    });

    const { page, cacheControl } = await service.getPage(
      undefined,
      'en',
      'user-1',
    );

    expect(page).toMatchObject({ audience: 'personal', version: VERSION });
    expect(rowIds(page)).toEqual([
      'row-0',
      'row-1',
      'row-2',
      'row-3',
      'row-4',
      'row-5',
    ]);
    expect(cacheControl).toBe(PRIVATE_HOME_CACHE_CONTROL);
    expect(refresh.requestRefresh).toHaveBeenCalledWith('user-1', 'en');
  });

  it('keeps public 48-Track rows at 12 in the personal fallback', async () => {
    const feed = feedOf(VERSION, 1);
    const items: HomeTrack[] = Array.from({ length: 48 }, (_, index) => ({
      id: `track-${index}`,
      title: `Track ${index}`,
      coverUrl: null,
      artistCredit: [],
      durationMs: null,
      vocalRange: null,
    }));
    feed.rows = [
      {
        id: 'row-0',
        layout: 'standard',
        title: { key: 'home.rows.newTracks', params: {} },
        items,
      },
    ];
    snapshots.readCurrent.mockResolvedValue(undefined);
    feeds.currentPublic.mockResolvedValue({ feed, cacheable: true });

    const { page } = await service.getPage(undefined, 'en', 'user-1');

    expect(page.audience).toBe('personal');
    expect(page.rows[0]?.layout).toBe('standard');
    if (page.rows[0]?.layout !== 'standard') {
      throw new Error('expected a standard row');
    }
    expect(page.rows[0].items).toHaveLength(12);
  });

  it('resumes the snapshot version with a personal page', async () => {
    snapshots.readCurrent.mockResolvedValue(
      personalOf('b2c3d4e5f6a70819', freshAt()),
    );
    const cursor = encodeHomeCursor({
      version: 'b2c3d4e5f6a70819',
      position: 0,
    });

    const { page } = await service.getPage(cursor, 'en', 'user-1');

    expect(page.audience).toBe('personal');
    expect(snapshots.readRetired).not.toHaveBeenCalled();
    expect(feeds.publicVersion).not.toHaveBeenCalled();
  });

  it('falls back to the public version for a cursor it no longer serves', async () => {
    snapshots.readCurrent.mockResolvedValue(
      personalOf('b2c3d4e5f6a70819', freshAt()),
    );
    snapshots.readRetired.mockResolvedValue(undefined);
    feeds.publicVersion.mockResolvedValue(feedOf(VERSION, 8));
    const cursor = encodeHomeCursor({ version: VERSION, position: 6 });

    const { page, cacheControl } = await service.getPage(
      cursor,
      'en',
      'user-1',
    );

    expect(page).toMatchObject({ audience: 'personal', version: VERSION });
    expect(rowIds(page)).toEqual(['row-6', 'row-7']);
    expect(cacheControl).toBe(PRIVATE_HOME_CACHE_CONTROL);
  });

  it('answers 404 when no feed serves the cursor version', async () => {
    snapshots.readCurrent.mockResolvedValue(
      personalOf('b2c3d4e5f6a70819', freshAt()),
    );
    snapshots.readRetired.mockResolvedValue(undefined);
    feeds.publicVersion.mockResolvedValue(undefined);
    const cursor = encodeHomeCursor({
      version: '0000000000000000',
      position: 6,
    });

    const error = await service
      .getPage(cursor, 'en', 'user-1')
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      details: { reason: 'FEED_VERSION_EXPIRED' },
    });
  });
});

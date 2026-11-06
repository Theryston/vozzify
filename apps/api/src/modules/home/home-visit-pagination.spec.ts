import { Test } from '@nestjs/testing';
import type { HomeRow } from '@vozzify/contracts';
import { HomeService } from './home.service.js';
import { encodeHomeCursor } from './home-cursor.js';
import { HomeFeedService } from './home-feed.service.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { personalHomeVersion } from './home-personal-version.js';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { HomeSocialService } from './home-social.service.js';
import { HomeVisitService } from './home-visit.service.js';
import { HomeVisitStore, type StoredHomeVisit } from './home-visit.store.js';

const row = (id: string): HomeRow => ({
  id,
  layout: 'standard',
  title: { key: 'home.rows.newTracks', params: {} },
  items: [],
});

const version = 'a1b2c3d4e5f60718';
const visitVersion = '1111222233334444';
const feed = {
  audience: 'public' as const,
  locale: 'en' as const,
  version,
  algorithmVersion: 1,
  rows: Array.from({ length: 8 }, (_, index) => row(`row-${index}`)),
};

describe('HomeService frozen visit paging', () => {
  const feeds = { currentPublic: vi.fn(), publicVersion: vi.fn() };
  const overlay = { apply: vi.fn(), refreshFrozen: vi.fn() };
  const visits = {
    create: vi.fn(),
    publicVersion: vi.fn(),
    personalVersion: vi.fn(),
  };
  const snapshots = { readCurrent: vi.fn(), readRetired: vi.fn() };
  let service: HomeService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: HomeFeedService, useValue: feeds },
        { provide: HomePinOverlayService, useValue: overlay },
        { provide: HomeVisitService, useValue: visits },
        { provide: PersonalHomeStore, useValue: snapshots },
      ],
    }).compile();
    service = module.get(HomeService);
  });

  it('keeps later rows in place when a Pin ends during paging', async () => {
    const pin = { ...row('pin-featured'), sponsored: true } as HomeRow;
    const visibleRows = [...feed.rows.slice(0, 6), pin, row('row-7')];
    const visit = {
      ...feed,
      version: visitVersion,
      rows: visibleRows,
      ownerId: null,
    } satisfies StoredHomeVisit;
    feeds.currentPublic.mockResolvedValue({ feed, cacheable: true });
    overlay.apply.mockResolvedValue(visibleRows);
    visits.create.mockResolvedValue(visit);

    const first = await service.getPage(undefined, 'en');
    expect(first.page.version).toBe(visitVersion);
    expect(first.page.nextCursor).toBe(
      encodeHomeCursor({ version: visitVersion, position: 6 }),
    );

    visits.publicVersion.mockResolvedValue({
      ...visit,
      rows: [...visibleRows.slice(0, 6), null, row('row-7')],
    });
    const next = await service.getPage(
      first.page.nextCursor ?? undefined,
      'en',
    );

    expect(next.page.rows.map((item) => item.id)).toEqual(['row-7']);
    expect(next.page.version).toBe(visitVersion);
  });

  it("does not serve another User's retired personal snapshot by cursor", async () => {
    const privateRows = [row('private-row')];
    const ownerVersion = personalHomeVersion('user-a', 'en', 1, privateRows);
    snapshots.readCurrent.mockResolvedValue(undefined);
    snapshots.readRetired.mockResolvedValue({
      audience: 'personal',
      locale: 'en',
      version: ownerVersion,
      algorithmVersion: 1,
      rows: privateRows,
      generatedAt: new Date().toISOString(),
    });
    feeds.publicVersion.mockResolvedValue(feed);
    overlay.apply.mockResolvedValue(feed.rows);

    const page = await service.getPage(
      encodeHomeCursor({ version: ownerVersion, position: 0 }),
      'en',
      'user-b',
    );

    expect(page.page.rows.map((item) => item.id)).toEqual(
      feed.rows.slice(0, 6).map((item) => item.id),
    );
    expect(page.cacheControl).toBe('private, no-store');
  });

  it('rechecks Pin audience when a visitor reuses a cursor after signing in', async () => {
    const publicVisit = {
      audience: 'public' as const,
      locale: 'en' as const,
      ownerId: null,
      version: visitVersion,
      algorithmVersion: 1,
      rows: [row('pin-visitors-only'), row('stable-row')],
    } satisfies StoredHomeVisit;
    snapshots.readCurrent.mockResolvedValue(undefined);
    snapshots.readRetired.mockResolvedValue(undefined);
    visits.publicVersion.mockResolvedValue({
      ...publicVisit,
      rows: [null, row('stable-row')],
    });

    const page = await service.getPage(
      encodeHomeCursor({ version: visitVersion, position: 0 }),
      'en',
      'user-b',
    );

    expect(visits.publicVersion).toHaveBeenCalledWith(visitVersion, true);
    expect(page.page.rows.map((item) => item.id)).toEqual(['stable-row']);
    expect(page.cacheControl).toBe('private, no-store');
  });
});

describe('HomeVisitService privacy and live social rows', () => {
  const store = { create: vi.fn(), read: vi.fn() };
  const pins = { apply: vi.fn(), refreshFrozen: vi.fn() };
  const social = { rowsFor: vi.fn() };
  const feeds = { currentPublic: vi.fn() };
  let service: HomeVisitService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        HomeVisitService,
        { provide: HomeVisitStore, useValue: store },
        { provide: HomePinOverlayService, useValue: pins },
        { provide: HomeSocialService, useValue: social },
        { provide: HomeFeedService, useValue: feeds },
      ],
    }).compile();
    service = module.get(HomeVisitService);
  });

  it('rejects a personal visit for a different owner or locale', async () => {
    store.read.mockResolvedValue({
      audience: 'personal',
      locale: 'en',
      ownerId: 'user-a',
      version: visitVersion,
      algorithmVersion: 1,
      rows: [row('stable-row')],
    } satisfies StoredHomeVisit);

    await expect(
      service.personalVersion(visitVersion, 'user-b', 'en'),
    ).resolves.toBeUndefined();
    await expect(
      service.personalVersion(visitVersion, 'user-a', 'pt-BR'),
    ).resolves.toBeUndefined();
  });

  it('recreates an expired public visit only when the deterministic composition matches', async () => {
    const recreated = {
      audience: 'public' as const,
      locale: 'en' as const,
      ownerId: null,
      version: visitVersion,
      algorithmVersion: feed.algorithmVersion,
      rows: feed.rows,
    } satisfies StoredHomeVisit;
    store.read.mockResolvedValue(undefined);
    feeds.currentPublic.mockResolvedValue({ feed, cacheable: true });
    pins.apply.mockResolvedValue(feed.rows);
    store.create.mockResolvedValue(recreated);
    pins.refreshFrozen.mockImplementation(async (rows: HomeRow[]) => rows);

    const result = await service.publicVersion(visitVersion, false);

    expect(store.create).toHaveBeenCalledWith({
      ...feed,
      rows: feed.rows,
      locale: 'en',
    });
    expect(result?.version).toBe(visitVersion);
  });

  it('keeps only originally frozen people in their original order', async () => {
    const people: Extract<HomeRow, { layout: 'people' }> = {
      id: 'social-friends',
      layout: 'people' as const,
      title: { key: 'home.rows.newTracks', params: {} },
      items: [
        {
          id: 'profile-b',
          username: 'b',
          name: 'B',
          image: null,
          commonTracks: 1,
        },
        {
          id: 'profile-a',
          username: 'a',
          name: 'A',
          image: null,
          commonTracks: 1,
        },
        {
          id: 'profile-c',
          username: 'c',
          name: 'C',
          image: null,
          commonTracks: 1,
        },
        {
          id: 'profile-removed',
          username: 'removed',
          name: 'Removed',
          image: null,
          commonTracks: 1,
        },
      ],
    };
    store.read.mockResolvedValue({
      audience: 'personal',
      locale: 'en',
      ownerId: 'user-a',
      version: visitVersion,
      algorithmVersion: 1,
      rows: [people],
    } satisfies StoredHomeVisit);
    pins.refreshFrozen.mockImplementation(async (rows: HomeRow[]) => rows);
    social.rowsFor.mockResolvedValue([
      {
        ...people,
        items: [
          people.items[2],
          {
            id: 'newly-visible',
            username: 'new',
            name: 'New',
            image: null,
            commonTracks: 1,
          },
          people.items[0],
          people.items[1],
        ],
      },
    ]);

    const visit = await service.personalVersion(visitVersion, 'user-a', 'en');

    const visible = visit?.rows[0];
    expect(visible?.layout).toBe('people');
    if (visible?.layout !== 'people') throw new Error('People row was omitted');
    expect(visible.items.map((item) => item.id)).toEqual([
      'profile-b',
      'profile-a',
      'profile-c',
    ]);
  });
});

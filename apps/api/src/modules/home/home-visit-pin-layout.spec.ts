import { Test } from '@nestjs/testing';
import type { HomeRow } from '@vozzify/contracts';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { HomeSocialService } from './home-social.service.js';
import { HomeVisitService } from './home-visit.service.js';
import { HomeVisitStore } from './home-visit.store.js';

describe('HomeVisitService frozen Pin roles', () => {
  it('keeps a frozen row Pin in its original non-hero slot role', async () => {
    const frozen: HomeRow = {
      id: 'pin-later',
      layout: 'standard',
      title: { key: 'home.rows.pinned', params: { title: 'Later pin' } },
      items: [],
    };
    const liveHero: HomeRow = {
      id: 'pin-later',
      layout: 'hero',
      track: {
        id: 'track-1',
        title: 'Song',
        coverUrl: null,
        artistCredit: [],
        durationMs: 180_000,
        vocalRange: null,
      },
    };
    const visitStore = {
      read: vi.fn().mockResolvedValue({
        audience: 'public',
        locale: 'en',
        ownerId: null,
        version: 'a1b2c3d4e5f60718',
        algorithmVersion: 1,
        rows: [frozen],
      }),
    };
    const pins = {
      refreshFrozen: vi.fn().mockResolvedValue([liveHero]),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        HomeVisitService,
        { provide: HomeVisitStore, useValue: visitStore },
        { provide: HomePinOverlayService, useValue: pins },
        { provide: HomeSocialService, useValue: { rowsFor: vi.fn() } },
      ],
    }).compile();

    const result = await moduleRef
      .get(HomeVisitService)
      .publicVersion('a1b2c3d4e5f60718', false);

    expect(result?.rows[0]).toMatchObject({
      id: 'pin-later',
      layout: 'standard',
    });
  });

  it.each([
    { sponsored: true, title: 'Updated title' },
    { sponsored: undefined, title: 'Updated title' },
  ])(
    'keeps live metadata when a frozen hero becomes a row: %s',
    async ({ sponsored, title }) => {
      const frozen: HomeRow = {
        id: 'pin-featured',
        layout: 'hero',
        track: {
          id: 'old-track',
          title: 'Old song',
          coverUrl: null,
          artistCredit: [],
          durationMs: 180_000,
          vocalRange: null,
        },
      };
      const liveRow: HomeRow = {
        id: 'pin-featured',
        layout: 'standard',
        title: { key: 'home.rows.pinned', params: { title } },
        ...(sponsored === undefined ? {} : { sponsored }),
        items: [
          {
            id: 'new-track',
            title: 'New song',
            coverUrl: null,
            artistCredit: [],
            durationMs: 180_000,
            vocalRange: null,
          },
        ],
      };
      const visitStore = {
        read: vi.fn().mockResolvedValue({
          audience: 'public',
          locale: 'en',
          ownerId: null,
          version: 'a1b2c3d4e5f60718',
          algorithmVersion: 1,
          rows: [frozen],
        }),
      };
      const pins = { refreshFrozen: vi.fn().mockResolvedValue([liveRow]) };
      const moduleRef = await Test.createTestingModule({
        providers: [
          HomeVisitService,
          { provide: HomeVisitStore, useValue: visitStore },
          { provide: HomePinOverlayService, useValue: pins },
          { provide: HomeSocialService, useValue: { rowsFor: vi.fn() } },
        ],
      }).compile();

      const result = await moduleRef
        .get(HomeVisitService)
        .publicVersion('a1b2c3d4e5f60718', false);

      expect(result?.rows[0]).toMatchObject({
        id: 'pin-featured',
        layout: 'hero',
        track: { id: 'new-track' },
      });
      expect(result?.rows[0]).not.toHaveProperty('title');
      expect(result?.rows[0]?.sponsored).toBe(sponsored);
    },
  );

  it.each([{ sponsored: true }, { sponsored: undefined }])(
    'updates sponsorship when a frozen row becomes a hero (%s)',
    async ({ sponsored }) => {
      const frozen: HomeRow = {
        id: 'pin-featured',
        layout: 'standard',
        title: { key: 'home.rows.pinned', params: { title: 'Frozen title' } },
        sponsored: !sponsored,
        items: [
          {
            id: 'old-track',
            title: 'Old song',
            coverUrl: null,
            artistCredit: [],
            durationMs: 180_000,
            vocalRange: null,
          },
        ],
      };
      const liveHero: HomeRow = {
        id: 'pin-featured',
        layout: 'hero',
        ...(sponsored === undefined ? {} : { sponsored }),
        track: {
          id: 'new-track',
          title: 'New song',
          coverUrl: null,
          artistCredit: [],
          durationMs: 180_000,
          vocalRange: null,
        },
      };
      const visitStore = {
        read: vi.fn().mockResolvedValue({
          audience: 'public',
          locale: 'en',
          ownerId: null,
          version: 'a1b2c3d4e5f60718',
          algorithmVersion: 1,
          rows: [frozen],
        }),
      };
      const pins = { refreshFrozen: vi.fn().mockResolvedValue([liveHero]) };
      const moduleRef = await Test.createTestingModule({
        providers: [
          HomeVisitService,
          { provide: HomeVisitStore, useValue: visitStore },
          { provide: HomePinOverlayService, useValue: pins },
          { provide: HomeSocialService, useValue: { rowsFor: vi.fn() } },
        ],
      }).compile();

      const result = await moduleRef
        .get(HomeVisitService)
        .publicVersion('a1b2c3d4e5f60718', false);

      expect(result?.rows[0]).toMatchObject({
        id: 'pin-featured',
        layout: 'standard',
        title: frozen.title,
        items: [{ id: 'new-track' }],
      });
      expect(result?.rows[0]?.sponsored).toBe(sponsored);
    },
  );
});

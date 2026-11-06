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
});

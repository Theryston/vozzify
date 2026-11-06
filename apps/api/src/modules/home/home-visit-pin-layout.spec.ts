import { Test } from '@nestjs/testing';
import type { HomeCarouselRow, HomeHero, HomeRow } from '@vozzify/contracts';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { HomeSocialService } from './home-social.service.js';
import { HomeVisitService } from './home-visit.service.js';
import { HomeVisitStore } from './home-visit.store.js';

const pinTrack = (id: string, title: string) => ({
  id,
  title,
  coverUrl: null,
  artistCredit: [],
  durationMs: 180_000,
  vocalRange: null,
});

const heroPin = (
  id: string,
  trackId: string,
  sponsored?: boolean,
): HomeHero => ({
  id,
  layout: 'hero',
  ...(sponsored === undefined ? {} : { sponsored }),
  track: pinTrack(trackId, trackId),
});

const standardPin = (
  id: string,
  title: string,
  trackIds: string[],
  sponsored?: boolean,
): HomeCarouselRow => ({
  id,
  layout: 'standard',
  title: { key: 'home.rows.pinned', params: { title } },
  ...(sponsored === undefined ? {} : { sponsored }),
  items: trackIds.map((trackId) => pinTrack(trackId, trackId)),
});

const refreshedVisitRow = async (
  frozen: HomeRow,
  refreshed: HomeRow,
): Promise<HomeRow | null | undefined> => {
  const version = 'a1b2c3d4e5f60718';
  const moduleRef = await Test.createTestingModule({
    providers: [
      HomeVisitService,
      {
        provide: HomeVisitStore,
        useValue: {
          read: vi.fn().mockResolvedValue({
            audience: 'public',
            locale: 'en',
            ownerId: null,
            version,
            algorithmVersion: 1,
            rows: [frozen],
          }),
        },
      },
      {
        provide: HomePinOverlayService,
        useValue: { refreshFrozen: vi.fn().mockResolvedValue([refreshed]) },
      },
      { provide: HomeSocialService, useValue: { rowsFor: vi.fn() } },
    ],
  }).compile();
  const visit = await moduleRef
    .get(HomeVisitService)
    .publicVersion(version, false);
  return visit?.rows[0];
};

describe('HomeVisitService frozen Pin roles', () => {
  it('keeps a frozen row Pin in its original non-hero slot role', async () => {
    const result = await refreshedVisitRow(
      standardPin('pin-later', 'Later pin', []),
      heroPin('pin-later', 'track-1'),
    );

    expect(result).toMatchObject({
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
      const result = await refreshedVisitRow(
        heroPin('pin-featured', 'old-track'),
        standardPin('pin-featured', title, ['new-track'], sponsored),
      );

      expect(result).toMatchObject({
        id: 'pin-featured',
        layout: 'hero',
        track: { id: 'new-track' },
      });
      expect(result).not.toHaveProperty('title');
      expect(result?.sponsored).toBe(sponsored);
    },
  );

  it.each([{ sponsored: true }, { sponsored: undefined }])(
    'updates sponsorship when a frozen row becomes a hero (%s)',
    async ({ sponsored }) => {
      const frozen = standardPin(
        'pin-featured',
        'Frozen title',
        ['old-track'],
        !sponsored,
      );
      const result = await refreshedVisitRow(
        frozen,
        heroPin('pin-featured', 'new-track', sponsored),
      );

      expect(result).toMatchObject({
        id: 'pin-featured',
        layout: 'standard',
        title: frozen.title,
        items: [{ id: 'new-track' }],
      });
      expect(result?.sponsored).toBe(sponsored);
    },
  );
});

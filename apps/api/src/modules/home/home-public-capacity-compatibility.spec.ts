import { Test } from '@nestjs/testing';
import type { HomeRow } from '@vozzify/contracts';
import { EditorialPinsService } from '../editorial-pins/editorial-pins.service.js';
import { HomeRepository } from './home.repository.js';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { composePublicVisitRows } from './home-public-visit-composer.js';
import {
  HOME_ROW_SOURCES,
  type HomeCandidate,
  type HomeRowSource,
} from './home-row-sources.js';

const openOverlay = (sources: HomeRowSource[] = []) =>
  Test.createTestingModule({
    providers: [
      HomePinOverlayService,
      {
        provide: EditorialPinsService,
        useValue: { findLivePins: vi.fn().mockResolvedValue([]) },
      },
      { provide: HomeRepository, useValue: {} },
      { provide: HOME_ROW_SOURCES, useValue: sources },
    ],
  }).compile();

it('preserves the personal minimum when public capacity applies live Pins', async () => {
  const moduleRef = await openOverlay();
  const rows: HomeRow[] = [
    {
      id: 'because-you-sang',
      layout: 'standard',
      title: { key: 'home.rows.becauseYouSang', params: {} },
      items: Array.from({ length: 3 }, (_, index) => ({
        id: `track-${index}`,
        title: `Track ${index}`,
        coverUrl: null,
        artistCredit: [],
        durationMs: null,
        vocalRange: null,
      })),
    },
  ];
  try {
    await expect(
      moduleRef.get(HomePinOverlayService).apply(rows, {
        locale: 'en',
        signedIn: true,
        audience: 'personal',
      }),
    ).resolves.toEqual(rows);
  } finally {
    await moduleRef.close();
  }
});

it('reuses complete background Rows without reading sources and keeps candidate metadata private', async () => {
  const items: HomeCandidate[] = Array.from({ length: 48 }, (_, index) => ({
    id: `track-${index}`,
    title: `Track ${index}`,
    coverUrl: null,
    artistCredit: [],
    durationMs: null,
    vocalRange: null,
    artistKey: `artist-${index}`,
    isCompleted: true,
    hasCover: false,
  }));
  const loadPage = vi.fn(async () => ({ items, hasMore: false }));
  const source: HomeRowSource = {
    id: 'trending-today',
    layout: 'standard',
    title: { key: 'home.rows.trendingToday', params: {} },
    load: async () => items,
    loadPage,
  };
  const feed = await new HomeFeedBuilder([source]).build();
  loadPage.mockClear();
  const moduleRef = await openOverlay([source]);
  try {
    await expect(
      moduleRef
        .get(HomePinOverlayService)
        .apply(
          feed.rows,
          { locale: 'en', signedIn: false },
          feed.compositionCandidates,
        ),
    ).resolves.toEqual(feed.rows);
    expect(loadPage).not.toHaveBeenCalled();
    const [recomposed] = composePublicVisitRows(
      feed.rows,
      feed.compositionCandidates,
      [],
    );
    expect(recomposed?.layout).toBe('standard');
    if (recomposed?.layout !== 'standard')
      throw new Error('expected standard Row');
    expect(recomposed.items).toHaveLength(48);
    for (const item of recomposed.items) {
      expect(item).not.toHaveProperty('sourcePosition');
      expect(item).not.toHaveProperty('artistKey');
    }
  } finally {
    await moduleRef.close();
  }
});

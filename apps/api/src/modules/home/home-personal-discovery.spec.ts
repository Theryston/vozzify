import type { HomeTrack } from '@vozzify/contracts';
import { describe, expect, it } from 'vitest';
import type { DiscoveryCandidate } from './home-personal-blend.js';
import { buildPersonalDiscoveryRows } from './home-personal-discovery.js';

const discoveryCandidate = (
  id: string,
  blended: number,
): DiscoveryCandidate => {
  const track: HomeTrack = {
    id,
    title: id,
    coverUrl: `${id}.webp`,
    artistCredit: [{ name: `Artist ${id}`, joinPhrase: '', artistId: null }],
    durationMs: 180_000,
    vocalRange: { lowest: 48, highest: 53 },
  };
  return {
    track,
    artistKey: `Artist ${id}`,
    hasCover: true,
    popularity: blended,
    personal: 0,
    blended,
  };
};

describe('buildPersonalDiscoveryRows', () => {
  it('replenishes an exhausted public source from its matching category', () => {
    const mastered = Array.from(
      { length: 6 },
      (_, index) => `mastered-${index}`,
    );
    const replacements = Array.from({ length: 6 }, (_, index) =>
      discoveryCandidate(`replacement-${index}`, 10 - index),
    );
    const publicRows = [
      {
        id: 'trending-today',
        layout: 'standard' as const,
        title: { key: 'home.rows.trendingToday', params: {} },
        items: mastered.map((id) => ({
          id,
          title: id,
          coverUrl: `${id}.webp`,
          artistCredit: [],
          durationMs: 180_000,
          vocalRange: { lowest: 48, highest: 53 },
        })),
      },
    ];

    const rows = buildPersonalDiscoveryRows({
      publicRows,
      candidatesByRow: {
        'trending-today': replacements.map(({ track }) => track),
      },
      catalogCandidates: replacements,
      sorted: replacements,
      masteredTrackIds: new Set(mastered),
      alreadyUsedTrackIds: new Set(),
    });

    const trending = rows.find((row) => row.id === 'trending-today');
    expect(trending?.layout).toBe('standard');
    if (trending?.layout !== 'standard')
      throw new Error('Missing trending row');
    expect(trending.title).toEqual(publicRows[0]?.title);
    expect(trending.items.map((track) => track.id)).toEqual([
      'replacement-1',
      'replacement-2',
      'replacement-3',
      'replacement-4',
      'replacement-5',
    ]);
    expect(trending.items.some((track) => mastered.includes(track.id))).toBe(
      false,
    );
  });
});

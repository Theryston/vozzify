import { describe, expect, it } from 'vitest';
import { composeHomeRows } from './home-feed-composer.js';

describe('Stage 2 Artist diversity', () => {
  it('caps every credited Artist and fills the Row from later eligible candidates', () => {
    const tracks = [
      { id: '1', artistKey: 'lead-1', artistKeys: ['lead-1', 'guest'] },
      { id: '2', artistKey: 'lead-2', artistKeys: ['lead-2', 'guest'] },
      { id: '3', artistKey: 'lead-3', artistKeys: ['lead-3', 'guest'] },
      { id: '4', artistKey: 'lead-4', artistKeys: ['lead-4'] },
      { id: '5', artistKey: 'lead-5', artistKeys: ['lead-5'] },
      { id: '6', artistKey: 'lead-6', artistKeys: ['lead-6'] },
      { id: '7', artistKey: 'lead-7', artistKeys: ['lead-7'] },
    ].map((track) => ({
      ...track,
      hasCover: true,
      isCompleted: true,
    }));
    const [row] = composeHomeRows([
      { id: 'test', layout: 'standard' as const, items: tracks },
    ]);

    expect(row?.items.map((track) => track.id)).toEqual([
      '1',
      '2',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(
      row?.items.filter((track) => track.artistKeys?.includes('guest')),
    ).toHaveLength(2);
  });

  it('reduces a repeated Artist ranking before an equally eligible alternative', () => {
    const firstRow = [
      { id: 'shared-first', artistKey: 'shared', artistKeys: ['shared'] },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `first-${index}`,
        artistKey: `first-${index}`,
        artistKeys: [`first-${index}`],
      })),
    ];
    const secondRow = [
      { id: 'shared-again', artistKey: 'shared', artistKeys: ['shared'] },
      { id: 'fresh-first', artistKey: 'fresh', artistKeys: ['fresh'] },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `second-${index}`,
        artistKey: `second-${index}`,
        artistKeys: [`second-${index}`],
      })),
    ];
    const rows = composeHomeRows([
      {
        id: 'first',
        layout: 'standard' as const,
        items: firstRow.map((track) => ({
          ...track,
          hasCover: true,
          isCompleted: true,
        })),
      },
      {
        id: 'second',
        layout: 'standard' as const,
        items: secondRow.map((track) => ({
          ...track,
          hasCover: true,
          isCompleted: true,
        })),
      },
    ]);

    expect(rows[1]?.items[0]?.id).toBe('fresh-first');
  });
});

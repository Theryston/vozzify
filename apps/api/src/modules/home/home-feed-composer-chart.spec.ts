import type { HomeTrack } from '@vozzify/contracts';
import { composeHomeRows } from './home-feed-composer.js';

const track = (id: string) => ({
  id,
  artistKey: id,
  hasCover: true,
  isCompleted: true,
  card: {
    id,
    title: id,
    coverUrl: `https://cdn.example/${id}.webp`,
    artistCredit: [{ name: id, joinPhrase: '' }],
    durationMs: null,
    vocalRange: null,
  } satisfies HomeTrack,
});

describe('personal Row minimums', () => {
  it('allows a three-Track personal recommendation without weakening public rows', () => {
    const items = Array.from({ length: 3 }, (_, index) =>
      track(`track-${index}`),
    );
    const row = { id: 'because-you-sang', layout: 'standard' as const, items };

    expect(composeHomeRows([row])).toEqual([]);
    expect(
      composeHomeRows([row], { minimumItems: { standard: 3 } }),
    ).toHaveLength(1);
  });
});

describe('weekly chart composition', () => {
  it('keeps the chart order independent and reserves its Tracks from discovery', () => {
    const chart = Array.from({ length: 10 }, (_, index) =>
      track(`chart-${index + 1}`),
    );
    const discovery = [
      ...chart.slice(0, 3),
      ...Array.from({ length: 7 }, (_, index) => track(`extra-${index + 1}`)),
    ];
    const firstChartTrack = chart[0];
    if (!firstChartTrack) throw new Error('Missing chart fixture');
    const [hero, regular, ranked] = composeHomeRows([
      { id: 'hero', layout: 'hero' as const, items: [firstChartTrack] },
      { id: 'discovery', layout: 'standard' as const, items: discovery },
      { id: 'top-10-week', layout: 'ranked' as const, items: chart },
    ]);

    expect(hero?.items.map(({ id }) => id)).toEqual(['chart-1']);
    expect(regular?.items.map(({ id }) => id)).toEqual(
      Array.from({ length: 7 }, (_, index) => `extra-${index + 1}`),
    );
    expect(ranked?.items.map(({ id }) => id)).toEqual(
      chart.map(({ id }) => id),
    );
  });

  it('keeps same-Artist leaders and reserves only the published ten positions', () => {
    const chart = Array.from({ length: 12 }, (_, index) => ({
      ...track(`chart-${index + 1}`),
      artistKey: 'same-artist',
    }));
    const chartTail = chart[10];
    if (!chartTail) throw new Error('Missing chart tail fixture');
    const [discovery, ranked] = composeHomeRows([
      {
        id: 'discovery',
        layout: 'standard' as const,
        items: [
          chartTail,
          ...Array.from({ length: 5 }, (_, i) => track(`d${i}`)),
        ],
      },
      { id: 'top-10-week', layout: 'ranked' as const, items: chart },
    ]);

    expect(discovery?.items.map(({ id }) => id)).toContain('chart-11');
    expect(ranked?.items.map(({ id }) => id)).toEqual(
      chart.slice(0, 10).map(({ id }) => id),
    );
  });

  it('preserves every same-Artist practice Track in a resume row', () => {
    const resumes = Array.from({ length: 4 }, (_, index) => ({
      ...track(`resume-${index + 1}`),
      artistKey: 'same-artist',
    }));
    const [row] = composeHomeRows(
      [{ id: 'continue-singing', layout: 'standard' as const, items: resumes }],
      { minimumItems: { standard: 1 } },
    );

    expect(row?.items.map(({ id }) => id)).toEqual([
      'resume-1',
      'resume-2',
      'resume-3',
      'resume-4',
    ]);
  });
});

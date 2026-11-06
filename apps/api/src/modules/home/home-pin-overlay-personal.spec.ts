import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';

const track = (id: string): HomeTrack => ({
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
});

const pin = (id: string, position: number): OverlayPin => ({
  id,
  kind: 'row',
  position,
  priority: 1,
  createdAt: 1,
  sponsored: false,
  title: { key: 'home.rows.editorial', params: {} },
  tracks: Array.from({ length: 6 }, (_, index) => track(`${id}-${index}`)),
});

const standard = (id: string, items: HomeTrack[]): HomeRow => ({
  id,
  layout: 'standard',
  title: { key: `home.rows.${id}`, params: {} },
  items,
});

describe('personal editorial pin overlay', () => {
  it('keeps a quality people row within the first page after fixed pins', () => {
    const people: HomeRow = {
      id: 'people-who-sing-what-you-sing',
      layout: 'people',
      title: { key: 'home.rows.people', params: {} },
      items: Array.from({ length: 3 }, (_, index) => ({
        id: `person-${index}`,
        username: `singer-${index}`,
        name: `Singer ${index}`,
        image: null,
        commonTracks: 3,
      })),
    };
    const rows: HomeRow[] = [
      { id: 'hero', layout: 'hero', track: track('hero') },
      {
        id: 'daily-target',
        layout: 'daily-target',
        title: { key: 'home.rows.dailyTarget', params: {} },
        secondsLeft: 60,
        targetSeconds: 300,
        streakDays: 0,
        completedToday: false,
      },
      standard('continue-singing', [track('resume')]),
      standard('sing-again', [track('mastered')]),
      standard(
        'trending-today',
        Array.from({ length: 6 }, (_, i) => track(`trend-${i}`)),
      ),
      standard(
        'new-tracks',
        Array.from({ length: 6 }, (_, i) => track(`new-${i}`)),
      ),
      people,
    ];

    const result = applyEditorialPins(
      rows,
      [pin('first', 2), pin('second', 3)],
      'personal',
    );

    expect(result.slice(0, 6).map((row) => row.id)).toEqual([
      'hero',
      'daily-target',
      'pin-first',
      'pin-second',
      'continue-singing',
      'people-who-sing-what-you-sing',
    ]);
  });

  it('retains three-item personal standard Rows after an unrelated pin', () => {
    const rows = [
      standard('trending-today', [track('one'), track('two'), track('three')]),
    ];

    const personal = applyEditorialPins(
      rows,
      [pin('unrelated', 0)],
      'personal',
    );
    const publicRows = applyEditorialPins(rows, [pin('unrelated', 0)]);

    expect(personal.map((row) => row.id)).toEqual([
      'pin-unrelated',
      'trending-today',
    ]);
    expect(publicRows.map((row) => row.id)).toEqual(['pin-unrelated']);
  });

  it('retains three public recommendation Tracks after editorial filtering', () => {
    const rows = [
      standard('most-sung', [track('one'), track('two'), track('three')]),
      standard('most-favorited', [track('four'), track('five'), track('six')]),
    ];
    const result = applyEditorialPins(rows, [pin('unrelated', 0)]);
    expect(result.map((row) => row.id)).toEqual([
      'pin-unrelated',
      'most-sung',
      'most-favorited',
    ]);
    const belowMinimum = applyEditorialPins(
      [standard('most-sung', [track('one'), track('two')])],
      [],
    );
    expect(belowMinimum).toEqual([]);
  });

  it('keeps an eligible quality category in the first six without moving a later pin', () => {
    const people: HomeRow = {
      id: 'people-who-sing-what-you-sing',
      layout: 'people',
      title: { key: 'home.rows.people', params: {} },
      items: Array.from({ length: 3 }, (_, index) => ({
        id: `person-${index}`,
        username: `singer-${index}`,
        name: `Singer ${index}`,
        image: null,
        commonTracks: 3,
      })),
    };
    const rows: HomeRow[] = [
      { id: 'hero', layout: 'hero', track: track('hero') },
      {
        id: 'daily-target',
        layout: 'daily-target',
        title: { key: 'home.rows.dailyTarget', params: {} },
        secondsLeft: 60,
        targetSeconds: 300,
        streakDays: 0,
        completedToday: false,
      },
      standard('continue-singing', [track('resume')]),
      ...Array.from({ length: 5 }, (_, index) =>
        standard(
          `filler-${index}`,
          Array.from({ length: 6 }, (__, item) =>
            track(`filler-${index}-${item}`),
          ),
        ),
      ),
      people,
    ];
    const pins = [
      pin('two', 2),
      pin('three', 3),
      pin('four', 4),
      pin('five', 5),
    ];
    const result = applyEditorialPins(rows, pins, 'personal');
    expect(result.slice(0, 6).some((row) => row.id === people.id)).toBe(true);
    expect(result.findIndex((row) => row.id === 'pin-five')).toBe(6);
  });
});
